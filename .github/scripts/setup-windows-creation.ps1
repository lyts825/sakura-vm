$ErrorActionPreference = 'Stop'

python -m pip install --disable-pip-version-check -r native/seventh-creation-sandbox/requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Pinned creation runtime dependencies failed to install.' }

# Installer identity from the Microsoft winget manifest for this exact release.
$installer = Join-Path $env:RUNNER_TEMP 'tesseract-5.4.0.20240606.exe'
Invoke-WebRequest -Uri 'https://github.com/UB-Mannheim/tesseract/releases/download/v5.4.0.20240606/tesseract-ocr-w64-setup-5.4.0.20240606.exe' -OutFile $installer
if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ne 'C885FFF6998E0608BA4BB8AB51436E1C6775C2BAFC2559A19B423E18678B60C9') {
    throw 'Tesseract installer digest mismatch.'
}
$installation = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
if ($installation.ExitCode -ne 0) { throw "Tesseract installation failed: $($installation.ExitCode)" }
python native/seventh-creation-sandbox/prepare-runtime.py
if ($LASTEXITCODE -ne 0) { throw 'Creation runtime verification failed.' }
