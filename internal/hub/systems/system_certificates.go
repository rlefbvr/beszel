package systems

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"time"

	"github.com/henrygd/beszel/internal/common"
	"github.com/henrygd/beszel/internal/entities/system"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const (
	certificatesCollection     = "certificates"
	certificatePathsCollection = "certificate_paths"
	// certificatesInterval is how often the hub reads the certificates of a host.
	certificatesInterval = 6 * time.Hour
)

// ErrCertificatesBusy is returned while the certificates of the system are read.
var ErrCertificatesBusy = errors.New("certificates already being read")

// certTracker follows the reading of the certificates of a system.
type certTracker struct {
	syncing atomic.Bool
	// last reading, unix seconds
	last atomic.Int64
}

// maybeSyncCertificates reads the certificates of the host when they are older
// than certificatesInterval, in the background.
func (sys *System) maybeSyncCertificates(now time.Time) {
	if !sys.certificates.Load() || now.Unix()-sys.certs.last.Load() < int64(certificatesInterval/time.Second) {
		return
	}
	go func() {
		if err := sys.SyncCertificates(context.Background()); err != nil && !errors.Is(err, ErrCertificatesBusy) {
			sys.manager.hub.Logger().Debug("Certificates unavailable", "system", sys.Id, "err", err)
		}
	}()
}

// SyncCertificates reads the certificates of the host, with the files added by
// the users, and updates the records of the system: the certificates no longer
// found are removed. The expiry alerts are then checked.
func (sys *System) SyncCertificates(ctx context.Context) error {
	if !sys.certificates.Load() {
		return ErrAgentOutdated
	}
	if !sys.certs.syncing.CompareAndSwap(false, true) {
		return ErrCertificatesBusy
	}
	defer sys.certs.syncing.Store(false)
	hub := sys.manager.hub

	var paths []string
	pathRecords, _ := hub.FindAllRecords(certificatePathsCollection, dbx.HashExp{"system": sys.Id})
	for _, record := range pathRecords {
		paths = append(paths, record.GetString("path"))
	}

	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	var response system.CertificatesResponse
	if err := sys.forkRequest(ctx, common.GetCertificates, system.CertificatesRequest{Paths: paths}, &response); err != nil {
		return err
	}
	sys.certs.last.Store(time.Now().Unix())

	if err := saveCertificates(hub, sys.Id, response.Certificates); err != nil {
		return err
	}
	return hub.HandleCertificateAlerts(sys.Id)
}

// saveCertificates updates the certificate records of a system from the agent response.
func saveCertificates(app core.App, systemID string, certs []system.Certificate) error {
	collection, err := app.FindCachedCollectionByNameOrId(certificatesCollection)
	if err != nil {
		return err
	}
	return app.RunInTransaction(func(tx core.App) error {
		existing, err := tx.FindAllRecords(certificatesCollection, dbx.HashExp{"system": systemID})
		if err != nil {
			return err
		}
		byKey := make(map[string]*core.Record, len(existing))
		for _, record := range existing {
			byKey[record.GetString("key")] = record
		}
		for _, cert := range certs {
			record := byKey[cert.Key]
			delete(byKey, cert.Key)
			if record == nil {
				record = core.NewRecord(collection)
				record.Set("system", systemID)
				record.Set("key", cert.Key)
			}
			record.Set("path", cert.Path)
			record.Set("name", CertificateName(cert))
			record.Set("names", cert.Names)
			record.Set("subject", cert.Subject)
			record.Set("issuer", cert.Issuer)
			record.Set("not_before", dateOrEmpty(cert.NotBefore))
			record.Set("not_after", dateOrEmpty(cert.NotAfter))
			record.Set("fingerprint", cert.Fingerprint)
			record.Set("thumbprint", cert.Thumbprint)
			record.Set("serial", cert.Serial)
			record.Set("self_signed", cert.SelfSigned)
			record.Set("custom", cert.Custom)
			record.Set("error", cert.Error)
			uses := cert.Uses
			if uses == nil {
				uses = []system.CertificateUse{}
			}
			record.Set("uses", uses)
			if err := tx.Save(record); err != nil {
				return err
			}
		}
		for _, record := range byKey {
			if err := tx.Delete(record); err != nil {
				return err
			}
		}
		return nil
	})
}

// CertificateName is the name of a certificate: its first name (common name
// or alternative name), or the file of a certificate that could not be read.
func CertificateName(cert system.Certificate) string {
	if len(cert.Names) > 0 {
		return cert.Names[0]
	}
	if cert.Subject != "" {
		return cert.Subject
	}
	path := strings.ReplaceAll(cert.Path, `\`, "/")
	return path[strings.LastIndex(path, "/")+1:]
}

func dateOrEmpty(t time.Time) any {
	if t.IsZero() {
		return ""
	}
	return t.UTC()
}
