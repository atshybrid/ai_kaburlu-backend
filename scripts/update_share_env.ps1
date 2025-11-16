# PowerShell helper: update_share_env.ps1
# Usage: run in project root where .env is located
# This script will:
# - create a timestamped backup of .env
# - optionally extract SHA-256 fingerprint from a release keystore using keytool
# - update or add SHARE_DOMAIN, ANDROID_PACKAGE_NAME, ANDROID_SHA256_FINGERPRINT in .env

param()

$envFile = Join-Path -Path (Resolve-Path "$PSScriptRoot\.." ) -ChildPath ".env"
if (-not (Test-Path $envFile)) {
    Write-Error ".env not found at $envFile. Run this script from the repository's scripts folder or adjust the path.";
    exit 1
}

# Backup
$timestamp = Get-Date -Format yyyyMMddHHmmss
$backup = "$envFile.bak.$timestamp"
Copy-Item -Path $envFile -Destination $backup -Force
Write-Host "Backed up .env to $backup"

# Prompt for values
$shareDomain = Read-Host 'Enter SHARE_DOMAIN (e.g. https://app.example.com)'
$packageName = Read-Host 'Enter ANDROID_PACKAGE_NAME (e.g. com.example.app)'

# Keystore info (optional)
$keystore = Read-Host 'Path to release keystore (leave blank to skip SHA extraction)'
$fingerprint = ''
if ($keystore -and (Test-Path $keystore)) {
    $alias = Read-Host 'Keystore alias (e.g. myalias)'
    $storepass = Read-Host 'Keystore password (leave blank to run keytool interactively)'

    # Build keytool args
    $args = @('-list','-v','-keystore',$keystore,'-alias',$alias)
    if ($storepass -ne '') { $args += @('-storepass',$storepass) }

    try {
        $out = & keytool @args 2>&1
    } catch {
        Write-Error "Failed to run keytool. Ensure JDK keytool is installed and on PATH. Error: $_"
        exit 1
    }

    # Search for SHA256 line
    $match = $out | Select-String -Pattern 'SHA256:' -SimpleMatch | Select-Object -First 1
    if ($match) {
        $line = $match.ToString().Trim()
        # Expecting format: "SHA256: XX:YY:..."
        $parts = $line -split ':'
        if ($parts.Length -ge 2) {
            $fingerprint = ($parts[1..($parts.Length-1)] -join ':').Trim()
            $fingerprint = $fingerprint.ToUpper()
            Write-Host "Found SHA256 fingerprint: $fingerprint"
        }
    } else {
        Write-Warning "SHA256 line not found in keytool output. Inspect keytool output manually."
        Write-Host $out
    }
} elseif ($keystore -ne '') {
    Write-Warning "Keystore path provided but file not found: $keystore"
}

# Read .env and update or add keys
$content = Get-Content -Path $envFile -Raw

function Upsert-EnvKey([string]$key, [string]$value) {
    param()
    $pattern = "(?m)^(?:#\s*)?" + [regex]::Escape($key) + "=.*$"
    if ($script:content -match $pattern) {
        $script:content = [regex]::Replace($script:content, $pattern, "$key=$value")
    } else {
        $script:content += "`n$key=$value";
    }
}

if ($shareDomain -and $shareDomain.Trim() -ne '') { Upsert-EnvKey -key 'SHARE_DOMAIN' -value $shareDomain.Trim() }
if ($packageName -and $packageName.Trim() -ne '') { Upsert-EnvKey -key 'ANDROID_PACKAGE_NAME' -value $packageName.Trim() }
if ($fingerprint -and $fingerprint.Trim() -ne '') { Upsert-EnvKey -key 'ANDROID_SHA256_FINGERPRINT' -value $fingerprint.Trim() }

# Write back
Set-Content -Path $envFile -Value $content -Force
Write-Host ".env updated. Review $envFile and the backup at $backup"

Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1) Rebuild and restart the server: `npm run build` then `npm start`" -ForegroundColor Yellow
Write-Host "2) Test endpoints: GET /api/articles/{shortNewsId} and open share page /<lang>/short/<slug>-<id>" -ForegroundColor Yellow

Write-Host "Done." -ForegroundColor Green
