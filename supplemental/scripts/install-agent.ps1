param (
    [switch]$Elevated,
    [Parameter(Mandatory=$true)]
    [string]$Key,
    [string]$Token = "",
    [string]$Url = "",
    [int]$Port = 45876,
    [string]$AgentPath = "",
    [string]$NSSMPath = "",
    [switch]$ConfigureFirewall,
    # Auto / GitHub download the agent from the GitHub releases of $Repo.
    # Scoop / WinGet install the upstream henrygd/beszel packages.
    [ValidateSet("Auto", "GitHub", "Scoop", "WinGet")]
    [string]$InstallMethod = "Auto",
    [string]$Version = "latest",
    # Name of the Windows service running the agent
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}$')]
    [string]$ServiceName = "beszel-agent",
    # Folder the GitHub method installs beszel-agent.exe (and NSSM if downloaded) to
    [string]$InstallDir = "$env:ProgramFiles\beszel-agent",
    # Set automatically from $PSBoundParameters below, or forwarded through an elevated relaunch.
    # Used so a reinstall only overwrites Token/Url/Port on an existing service if the caller
    # actually asked to change them, instead of wiping them with their unset defaults.
    [switch]$TokenProvided,
    [switch]$UrlProvided,
    [switch]$PortProvided
)

if (-not $Elevated) {
    $TokenProvided = $PSBoundParameters.ContainsKey('Token')
    $UrlProvided = $PSBoundParameters.ContainsKey('Url')
    $PortProvided = $PSBoundParameters.ContainsKey('Port')
}

# GitHub repository the agent is downloaded from
$Repo = "rlefbvr/beszel"

# Check if required parameters are provided
if ([string]::IsNullOrWhiteSpace($Key)) {
    Write-Host "ERROR: SSH Key is required." -ForegroundColor Red
    Write-Host "Usage: .\install-agent.ps1 -Key 'your-ssh-key-here' [-Token 'your-token-here'] [-Url 'your-hub-url-here'] [-Port port-number] [-InstallMethod Auto|GitHub|Scoop|WinGet] [-Version latest] [-ServiceName beszel-agent] [-InstallDir path] [-ConfigureFirewall]" -ForegroundColor Yellow
    Write-Host "Note: Token and Url are optional for backwards compatibility with older hub versions." -ForegroundColor Yellow
    exit 1
}

# Stop on first error
$ErrorActionPreference = "Stop"

#region Utility Functions

# Function to check if running as admin
function Test-Admin {
    return ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Function to check if a command exists
function Test-CommandExists {
    param (
        [Parameter(Mandatory=$true)]
        [string]$Command
    )
    return (Get-Command $Command -ErrorAction SilentlyContinue)
}

# Function to find beszel-agent in common installation locations
function Find-BeszelAgent {
    # First check if it's in PATH
    $agentCmd = Get-Command "beszel-agent" -ErrorAction SilentlyContinue
    if ($agentCmd) {
        return $agentCmd.Source
    }
    
    # Common installation paths to check
    $commonPaths = @(
        "$env:USERPROFILE\scoop\apps\beszel-agent\current\beszel-agent.exe",
        "$env:ProgramData\scoop\apps\beszel-agent\current\beszel-agent.exe",
        "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\henrygd.beszel-agent*\beszel-agent.exe",
        "$env:ProgramFiles\WinGet\Packages\henrygd.beszel-agent*\beszel-agent.exe",
        "${env:ProgramFiles(x86)}\WinGet\Packages\henrygd.beszel-agent*\beszel-agent.exe",
        "$env:ProgramFiles\beszel-agent\beszel-agent.exe",
        "$env:ProgramFiles(x86)\beszel-agent\beszel-agent.exe",
        "$env:SystemDrive\Users\*\scoop\apps\beszel-agent\current\beszel-agent.exe"
    )
    
    foreach ($path in $commonPaths) {
        # Handle wildcard paths
        if ($path.Contains("*")) {
            $foundPaths = Get-ChildItem -Path $path -ErrorAction SilentlyContinue
            if ($foundPaths) {
                return $foundPaths[0].FullName
            }
        } else {
            if (Test-Path $path) {
                return $path
            }
        }
    }
    
    return $null
}

# Function to find NSSM in common installation locations
function Find-NSSM {
    # First check if it's in PATH
    $nssmCmd = Get-Command "nssm" -ErrorAction SilentlyContinue
    if ($nssmCmd) {
        return $nssmCmd.Source
    }
    
    # Common installation paths to check
    $commonPaths = @(
        "$env:USERPROFILE\scoop\apps\nssm\current\nssm.exe",
        "$env:ProgramData\scoop\apps\nssm\current\nssm.exe",
        "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\NSSM.NSSM*\nssm.exe",
        "$env:ProgramFiles\WinGet\Packages\NSSM.NSSM*\nssm.exe",
        "${env:ProgramFiles(x86)}\WinGet\Packages\NSSM.NSSM*\nssm.exe",
        "$env:SystemDrive\Users\*\scoop\apps\nssm\current\nssm.exe"
    )
    
    foreach ($path in $commonPaths) {
        # Handle wildcard paths
        if ($path.Contains("*")) {
            $foundPaths = Get-ChildItem -Path $path -ErrorAction SilentlyContinue
            if ($foundPaths) {
                return $foundPaths[0].FullName
            }
        } else {
            if (Test-Path $path) {
                return $path
            }
        }
    }
    
    return $null
}

#endregion

#region Installation Methods

# Function to install Scoop
function Install-Scoop {
    Write-Host "Installing Scoop..."
    
    # Check if running as admin - Scoop should not be installed as admin
    if (Test-Admin) {
        throw "Scoop cannot be installed with administrator privileges. Please run this script as a regular user first to install Scoop and beszel-agent, then run as admin to configure the service."
    }
    
    try {
        Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression
        
        if (-not (Test-CommandExists "scoop")) {
            throw "Failed to install Scoop - command not available after installation"
        }
        Write-Host "Scoop installed successfully."
    }
    catch {
        throw "Failed to install Scoop: $($_.Exception.Message)"
    }
}

# Function to install Git via Scoop
function Install-Git {
    if (Test-CommandExists "git") {
        Write-Host "Git is already installed."
        return
    }
    
    Write-Host "Installing Git..."
    scoop install git
    
    if (-not (Test-CommandExists "git")) {
        throw "Failed to install Git"
    }
}

# Function to install NSSM
function Install-NSSM {
    param (
        [string]$Method = "Scoop" # Default to Scoop method
    )
    
    if (Test-CommandExists "nssm") {
        Write-Host "NSSM is already installed."
        return
    }
    
    Write-Host "Installing NSSM..."
    if ($Method -eq "Scoop") {
        scoop install nssm
    }
    elseif ($Method -eq "WinGet") {
        winget install -e --id NSSM.NSSM --accept-source-agreements --accept-package-agreements
        
        # Refresh PATH environment variable to make NSSM available in current session
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    }
    else {
        throw "Unsupported installation method: $Method"
    }
    
    if (-not (Test-CommandExists "nssm")) {
        throw "Failed to install NSSM"
    }
}

# Function to install beszel-agent with Scoop
function Install-BeszelAgentWithScoop {
    Write-Host "Adding beszel bucket..."
    scoop bucket add beszel https://github.com/henrygd/beszel-scoops | Out-Null
    
    Write-Host "Installing / updating beszel-agent..."
    scoop install beszel-agent | Out-Null
    
    if (-not (Test-CommandExists "beszel-agent")) {
        throw "Failed to install beszel-agent"
    }
    
    return $(Join-Path -Path $(scoop prefix beszel-agent) -ChildPath "beszel-agent.exe")
}

# Function to install beszel-agent with WinGet
function Install-BeszelAgentWithWinGet {
    Write-Host "Installing / updating beszel-agent..."
    
    # Temporarily change ErrorActionPreference to allow WinGet to complete and show output
    $originalErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    
    # Use call operator (&) and capture exit code properly
    & winget install --exact --id henrygd.beszel-agent --accept-source-agreements --accept-package-agreements | Out-Null
    $wingetExitCode = $LASTEXITCODE
    
    # Restore original ErrorActionPreference
    $ErrorActionPreference = $originalErrorActionPreference
    
    # WinGet exit codes:
    # 0 = Success
    # -1978335212 (0x8A150014) = No applicable upgrade found (package is up to date)
    # -1978335189 (0x8A15002B) = Another "no upgrade needed" variant
    # Other codes indicate actual errors
    if ($wingetExitCode -eq -1978335212 -or $wingetExitCode -eq -1978335189) {
        Write-Host "Package is already up to date." -ForegroundColor Green
    } elseif ($wingetExitCode -ne 0)  {
        Write-Host "WinGet exit code: $wingetExitCode" -ForegroundColor Yellow
    }
    
    # Refresh PATH environment variable to make beszel-agent available in current session
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    
    # Find the path to the beszel-agent executable
    $agentPath = (Get-Command beszel-agent -ErrorAction SilentlyContinue).Source
    
    if (-not $agentPath) {
        throw "Could not find beszel-agent executable path after installation"
    }
    
    return $agentPath
}

# Function to extract a zip archive, also on PowerShell 4 which lacks Expand-Archive
function Expand-Zip {
    param (
        [string]$Path,
        [string]$DestinationPath
    )
    if (Get-Command Expand-Archive -ErrorAction SilentlyContinue) {
        Expand-Archive -Path $Path -DestinationPath $DestinationPath -Force
    } else {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($Path, $DestinationPath)
    }
}

# Function to install beszel-agent from the GitHub releases of $Repo (requires admin)
function Install-BeszelAgentFromGitHub {
    param (
        [string]$Version = "latest"
    )

    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    if ($Version -eq "latest") {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -UseBasicParsing
        $Version = $release.tag_name
    }
    $Version = $Version.TrimStart("v")

    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "amd64" }
    $fileName = "beszel-agent_windows_$arch.zip"
    $baseUrl = "https://github.com/$Repo/releases/download/v$Version"
    $tempDir = Join-Path $env:TEMP "beszel-agent-$([guid]::NewGuid())"
    New-Item -ItemType Directory -Path $tempDir | Out-Null

    try {
        Write-Host "Downloading beszel-agent v$Version from github.com/$Repo..."
        $zipPath = Join-Path $tempDir $fileName
        $checksumsPath = Join-Path $tempDir "checksums.txt"
        Invoke-WebRequest -Uri "$baseUrl/$fileName" -OutFile $zipPath -UseBasicParsing
        Invoke-WebRequest -Uri "$baseUrl/beszel_${Version}_checksums.txt" -OutFile $checksumsPath -UseBasicParsing

        $expected = Get-Content $checksumsPath |
            Where-Object { ($_ -split "\s+")[1] -eq $fileName } |
            ForEach-Object { ($_ -split "\s+")[0] } |
            Select-Object -First 1
        if (-not $expected) {
            throw "Checksum not found for $fileName"
        }
        $actual = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash
        if ($actual -ne $expected.ToUpper()) {
            throw "Checksum verification failed: $actual != $expected"
        }

        Expand-Zip -Path $zipPath -DestinationPath (Join-Path $tempDir "agent")

        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        $agentPath = Join-Path $InstallDir "beszel-agent.exe"

        # Stop the service so the executable can be replaced
        $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if ($service -and $service.Status -ne "Stopped") {
            Write-Host "Stopping $ServiceName service..."
            Stop-Service -Name $ServiceName -Force
        }

        Copy-Item -Path (Join-Path $tempDir "agent\beszel-agent.exe") -Destination $agentPath -Force
        Write-Host "beszel-agent installed to $agentPath"
        return $agentPath
    }
    finally {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Function to download NSSM when neither WinGet nor Scoop is available (requires admin)
function Install-NSSMFromWeb {
    $nssmPath = Join-Path $InstallDir "nssm.exe"
    if (Test-Path $nssmPath) {
        return $nssmPath
    }

    Write-Host "Downloading NSSM..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $tempDir = Join-Path $env:TEMP "nssm-$([guid]::NewGuid())"
    New-Item -ItemType Directory -Path $tempDir | Out-Null
    try {
        $zipPath = Join-Path $tempDir "nssm.zip"
        Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $zipPath -UseBasicParsing
        Expand-Zip -Path $zipPath -DestinationPath $tempDir
        $arch = if ([Environment]::Is64BitOperatingSystem) { "win64" } else { "win32" }
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        Copy-Item -Path (Join-Path $tempDir "nssm-2.24\$arch\nssm.exe") -Destination $nssmPath -Force
        return $nssmPath
    }
    finally {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Function to install using Scoop
function Install-WithScoop {
    param (
        [string]$Key,
        [int]$Port
    )
    
    try {
        # Ensure Scoop is installed
        if (-not (Test-CommandExists "scoop")) {
            Install-Scoop | Out-Null
        }
        else {
            Write-Host "Scoop is already installed."
        }
        
        # Install Git (required for Scoop buckets)
        Install-Git | Out-Null
        
        # Install NSSM
        Install-NSSM -Method "Scoop" | Out-Null
        
        # Install beszel-agent
        $agentPath = Install-BeszelAgentWithScoop
        
        return $agentPath
    }
    catch {
        Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Installation failed. Please check the error message above." -ForegroundColor Red
        Write-Host "Press any key to exit..." -ForegroundColor Red
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        exit 1
    }
}

# Function to install using WinGet
function Install-WithWinGet {
    param (
        [string]$Key,
        [int]$Port
    )
    
    try {
        # Install NSSM
        Install-NSSM -Method "WinGet" | Out-Null
        
        # Install beszel-agent
        $agentPath = Install-BeszelAgentWithWinGet
        
        return $agentPath
    }
    catch {
        Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Installation failed. Please check the error message above." -ForegroundColor Red
        Write-Host "Press any key to exit..." -ForegroundColor Red
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        exit 1
    }
}

#endregion

#region Service Configuration

# Function to install and configure the NSSM service
function Install-NSSMService {
    param (
        [Parameter(Mandatory=$true)]
        [string]$AgentPath,
        [Parameter(Mandatory=$true)]
        [string]$Key,
        [string]$Token = "",
        [string]$HubUrl = "",
        [Parameter(Mandatory=$true)]
        [int]$Port,
        [string]$NSSMPath = "",
        [switch]$TokenProvided,
        [switch]$UrlProvided,
        [switch]$PortProvided
    )
    
    Write-Host "Installing $ServiceName service..."
    
    # Determine the NSSM executable to use
    $nssmCommand = "nssm"
    if ($NSSMPath -and (Test-Path $NSSMPath)) {
        $nssmCommand = $NSSMPath
        Write-Host "Using NSSM from: $NSSMPath"
    } elseif (-not (Test-CommandExists "nssm")) {
        throw "NSSM is not available in PATH and no valid NSSMPath was provided"
    }
    
    # Check if service already exists
    $existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($existingService) {
        Write-Host "Service already exists. Checking if path update is needed..."

        # Get current service path
        $pathNeedsUpdate = $true
        try {
            $currentPath = & $nssmCommand get $ServiceName Application
            if ($LASTEXITCODE -eq 0 -and $currentPath.Trim() -eq $AgentPath) {
                Write-Host "Service path is already correct. Updating environment variables..."
                & $nssmCommand set $ServiceName AppEnvironmentExtra "+KEY=$Key"
                if ($TokenProvided) { & $nssmCommand set $ServiceName AppEnvironmentExtra "+TOKEN=$Token" }
                if ($UrlProvided) { & $nssmCommand set $ServiceName AppEnvironmentExtra "+HUB_URL=$HubUrl" }
                if ($PortProvided) { & $nssmCommand set $ServiceName AppEnvironmentExtra "+PORT=$Port" }

                # Restart the service so the running process picks up the new environment variables
                if ($existingService.Status -eq "Running") {
                    Write-Host "Restarting service to apply updated environment variables..."
                    & $nssmCommand restart $ServiceName
                }
                return
            }

            Write-Host "Service path needs updating. Stopping and removing existing service..."
            Write-Host "  Current path: $($currentPath.Trim())"
            Write-Host "  New path: $AgentPath"
        } catch {
            Write-Host "Could not retrieve current service path, will recreate service: $($_.Exception.Message)" -ForegroundColor Yellow
            Write-Host "Service path needs updating. Stopping and removing existing service..."
        }

        try {
            & $nssmCommand stop $ServiceName
            & $nssmCommand remove $ServiceName confirm
        } catch {
            Write-Host "Warning: Failed to remove existing service: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    
    & $nssmCommand install $ServiceName $AgentPath
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install $ServiceName service"
    }
    
    Write-Host "Configuring service environment variables..."
    & $nssmCommand set $ServiceName AppEnvironmentExtra "+KEY=$Key"
    & $nssmCommand set $ServiceName AppEnvironmentExtra "+TOKEN=$Token"
    & $nssmCommand set $ServiceName AppEnvironmentExtra "+HUB_URL=$HubUrl"
    & $nssmCommand set $ServiceName AppEnvironmentExtra "+PORT=$Port"
    
    # Configure log files
    $logDir = "$env:ProgramData\beszel-agent\logs"
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    $logFile = "$logDir\$ServiceName.log"
    & $nssmCommand set $ServiceName AppStdout $logFile
    & $nssmCommand set $ServiceName AppStderr $logFile
}

# Function to configure firewall rules
function Configure-Firewall {
    param (
        [Parameter(Mandatory=$true)]
        [int]$Port
    )
    
    # Create a firewall rule if it doesn't exist
    $ruleName = "Allow $ServiceName"
    $existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    
    # Remove existing rule if found
    if ($existingRule) {
        Write-Host "Removing existing firewall rule..."
        try {
            Remove-NetFirewallRule -DisplayName $ruleName
            Write-Host "Existing firewall rule removed successfully."
        } catch {
            Write-Host "Warning: Failed to remove existing firewall rule: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    
    # Create new rule with current settings
    Write-Host "Creating firewall rule for $ServiceName on port $Port..."
    try {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port
        Write-Host "Firewall rule created successfully."
    } catch {
        Write-Host "Warning: Failed to create firewall rule: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "You may need to manually create a firewall rule for port $Port." -ForegroundColor Yellow
    }
}

# Function to start and monitor the service
function Start-BeszelAgentService {
    param (
        [string]$NSSMPath = ""
    )
    
    Write-Host "Starting $ServiceName service..."
    
    # Determine the NSSM executable to use
    $nssmCommand = "nssm"
    if ($NSSMPath -and (Test-Path $NSSMPath)) {
        $nssmCommand = $NSSMPath
    } elseif (-not (Test-CommandExists "nssm")) {
        throw "NSSM is not available in PATH and no valid NSSMPath was provided"
    }
    
    & $nssmCommand start $ServiceName
    $startResult = $LASTEXITCODE
    
    # Only enter the status check loop if the NSSM start command failed
    if ($startResult -ne 0) {
        Write-Host "NSSM start command returned error code: $startResult" -ForegroundColor Yellow
        Write-Host "This could be due to 'SERVICE_START_PENDING' state. Checking service status..."
        
        # Allow up to 10 seconds for the service to start, checking every second
        $maxWaitTime = 10 # seconds
        $elapsedTime = 0
        $serviceStarted = $false
        
        while (-not $serviceStarted -and $elapsedTime -lt $maxWaitTime) {
            Start-Sleep -Seconds 1
            $elapsedTime += 1

            $serviceStatus = & $nssmCommand status $ServiceName
            
            if ($serviceStatus -eq "SERVICE_RUNNING") {
                $serviceStarted = $true
                Write-Host "Success! The $ServiceName service is now running." -ForegroundColor Green
            }
            elseif ($serviceStatus -like "*PENDING*") {
                Write-Host "Service is still starting (status: $serviceStatus)... waiting" -ForegroundColor Yellow
            }
            else {
                Write-Host "Warning: The service status is '$serviceStatus' instead of 'SERVICE_RUNNING'." -ForegroundColor Yellow
                Write-Host "You may need to troubleshoot the service installation." -ForegroundColor Yellow
                break
            }
        }
        
        if (-not $serviceStarted) {
            Write-Host "Service did not reach running state." -ForegroundColor Yellow
            Write-Host "You can check status manually with 'nssm status $ServiceName'" -ForegroundColor Yellow
        }
    } else {
        # NSSM start command was successful
        Write-Host "Success! The $ServiceName service is running properly." -ForegroundColor Green
    }
}

#endregion

#region Main Script Execution

# Check if we're running as admin
$isAdmin = Test-Admin

try {
    # First: Install the agent (Scoop / WinGet don't require admin, GitHub does)
    $useGitHub = $InstallMethod -eq "Auto" -or $InstallMethod -eq "GitHub"
    if (-not $AgentPath -and $useGitHub) {
        if ($isAdmin -or $Elevated) {
            $AgentPath = Install-BeszelAgentFromGitHub -Version $Version
        }
        # otherwise the agent is downloaded after relaunching as admin
    }
    elseif (-not $AgentPath) {
        # Check for problematic case: running as admin and need Scoop
        if ($isAdmin -and -not (Test-CommandExists "scoop") -and -not (Test-CommandExists "winget")) {
            Write-Host "ERROR: You're running as administrator but neither Scoop nor WinGet is available." -ForegroundColor Red
            Write-Host "Scoop should be installed without admin privileges." -ForegroundColor Red
            Write-Host "" 
            Write-Host "Please either:" -ForegroundColor Yellow
            Write-Host "1. Run this script again without administrator privileges" -ForegroundColor Yellow
            Write-Host "2. Install WinGet and run this script again" -ForegroundColor Yellow
            exit 1
        }

        if ($InstallMethod -eq "Scoop") {
            if (-not (Test-CommandExists "scoop")) {
                throw "InstallMethod is set to Scoop, but Scoop is not available in PATH."
            }
            Write-Host "Using Scoop for installation..."
            $AgentPath = Install-WithScoop -Key $Key -Port $Port
        }
        else {
            if (-not (Test-CommandExists "winget")) {
                throw "InstallMethod is set to WinGet, but WinGet is not available in PATH."
            }
            Write-Host "Using WinGet for installation..."
            $AgentPath = Install-WithWinGet -Key $Key -Port $Port
        }
    }

    if (-not $AgentPath -and ($isAdmin -or $Elevated -or -not $useGitHub)) {
        throw "Could not find beszel-agent executable. Make sure it was properly installed."
    }
    
    # Find NSSM path if not already provided
    if (-not $NSSMPath) {
        $NSSMPath = Find-NSSM
        
        if (-not $NSSMPath -and (Test-CommandExists "nssm")) {
            $NSSMPath = (Get-Command "nssm" -ErrorAction SilentlyContinue).Source
        }
        
        # If we still don't have NSSM, try to install it if we have package managers
        # (the GitHub method downloads NSSM to $InstallDir instead, below)
        if (-not $NSSMPath) {
            if ($useGitHub) {
                # no package manager
            } elseif (Test-CommandExists "winget") {
                Write-Host "NSSM not found. Attempting to install via WinGet..."
                try {
                    Install-NSSM -Method "WinGet"
                    $NSSMPath = Find-NSSM
                    if (-not $NSSMPath -and (Test-CommandExists "nssm")) {
                        $NSSMPath = (Get-Command "nssm" -ErrorAction SilentlyContinue).Source
                    }
                } catch {
                    Write-Host "Failed to install NSSM via WinGet: $($_.Exception.Message)" -ForegroundColor Yellow
                }
            } elseif (Test-CommandExists "scoop") {
                Write-Host "NSSM not found. Attempting to install via Scoop..."
                try {
                    Install-NSSM -Method "Scoop"
                    $NSSMPath = Find-NSSM
                    if (-not $NSSMPath -and (Test-CommandExists "nssm")) {
                        $NSSMPath = (Get-Command "nssm" -ErrorAction SilentlyContinue).Source
                    }
                } catch {
                    Write-Host "Failed to install NSSM via Scoop: $($_.Exception.Message)" -ForegroundColor Yellow
                }
            }
            
            # Last resort: download NSSM directly (requires admin)
            if (-not $NSSMPath -and ($isAdmin -or $Elevated)) {
                try {
                    $NSSMPath = Install-NSSMFromWeb
                } catch {
                    Write-Host "Failed to download NSSM: $($_.Exception.Message)" -ForegroundColor Yellow
                }
            }

            # Final check - if we still don't have NSSM and we're admin, we have a problem
            if (-not $NSSMPath -and ($isAdmin -or $Elevated)) {
                throw "NSSM is required for service installation but was not found and could not be installed. Please install NSSM manually or run as a regular user to install it."
            }
        }
    }
    
    # Second: If we need admin rights for service installation and we don't have them, relaunch
    if (-not $isAdmin -and -not $Elevated) {
        Write-Host "Admin privileges required for service installation. Relaunching as admin..." -ForegroundColor Yellow
        Write-Host "Check service status with 'nssm status $ServiceName'"
        Write-Host "Edit service configuration with 'nssm edit $ServiceName'"
        
        # Prepare arguments for the elevated script
        $argumentList = @(
            "-ExecutionPolicy", "Bypass",
            "-File", "`"$PSCommandPath`"",
            "-Elevated",
            "-Key", "`"$Key`"",
            "-Token", "`"$Token`"",
            "-Url", "`"$Url`"",
            "-Port", $Port,
            "-AgentPath", "`"$AgentPath`"",
            "-InstallMethod", $InstallMethod,
            "-Version", $Version,
            "-ServiceName", $ServiceName,
            # no trailing backslash, it would escape the closing quote
            "-InstallDir", "`"$($InstallDir.TrimEnd('\'))`""
        )
        
        # Add NSSMPath if we found it
        if ($NSSMPath) {
            $argumentList += "-NSSMPath"
            $argumentList += "`"$NSSMPath`""
        }

        # Forward which optional values were explicitly provided, so the elevated
        # instance knows whether to overwrite them on an existing service
        if ($TokenProvided) { $argumentList += "-TokenProvided" }
        if ($UrlProvided) { $argumentList += "-UrlProvided" }
        if ($PortProvided) { $argumentList += "-PortProvided" }

        if ($ConfigureFirewall) {
            $argumentList += "-ConfigureFirewall"
        }
        
        # Relaunch the script with the -Elevated switch and pass parameters
        Start-Process powershell.exe -Verb RunAs -ArgumentList $argumentList
        exit
    }
    
    # Third: If we have admin rights, install service and configure firewall
    if ($isAdmin -or $Elevated) {
        # Install the service
        Install-NSSMService -AgentPath $AgentPath -Key $Key -Token $Token -HubUrl $Url -Port $Port -NSSMPath $NSSMPath -TokenProvided:$TokenProvided -UrlProvided:$UrlProvided -PortProvided:$PortProvided
        
        if ($ConfigureFirewall) {
            Configure-Firewall -Port $Port
        } else {
            Write-Host "Skipping firewall configuration. Use -ConfigureFirewall to add an inbound rule for port $Port." -ForegroundColor Yellow
        }
        
        # Start the service
        Start-BeszelAgentService -NSSMPath $NSSMPath
        
        # Pause to see results if this is an elevated window
        if ($Elevated) {
            Write-Host "Press any key to exit..." -ForegroundColor Cyan
            $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        }
    }
}
catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Installation failed. Please check the error message above." -ForegroundColor Red
    
    # Pause if this is likely a new window
    if ($Elevated -or (-not $isAdmin)) {
        Write-Host "Press any key to exit..." -ForegroundColor Red
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    }
    exit 1
}

#endregion
