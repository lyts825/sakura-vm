$ErrorActionPreference = 'Stop'

# Pin both native build targets; hosted runners do not guarantee an i686 compiler.
if (-not $env:RUNNER_TEMP -or -not $env:GITHUB_ENV) {
    throw 'This helper requires a GitHub Actions runner.'
}
$archiveTool = Join-Path $env:ProgramFiles '7-Zip/7z.exe'
$toolRoot = Join-Path $env:RUNNER_TEMP 'sakura-mingw-16.2.0'
$releaseUrl = 'https://github.com/brechtsanders/winlibs_mingw/releases/download/16.2.0posix-23.1.3-14.0.0-ucrt-r3'
$toolchains = @(
    @{
        Asset = 'winlibs-x86_64-posix-seh-gcc-16.2.0-mingw-w64ucrt-14.0.0-r3.7z'
        Sha256 = 'db014a73b71907c6c778fd1c938056cddcae9023f89f8dfff7783d9e45baf975'
        Directory = 'mingw64'
        Target = 'x86_64-w64-mingw32'
        Variable = 'SAKURA_NATIVE_CLIPBOARD_CXX'
    },
    @{
        Asset = 'winlibs-i686-posix-dwarf-gcc-16.2.0-mingw-w64ucrt-14.0.0-r3.7z'
        Sha256 = 'e7579b167bce7f16358874133eac11dc369eb02f1735ec33695d4f5b0da77fda'
        Directory = 'mingw32'
        Target = 'i686-w64-mingw32'
        Variable = 'SAKURA_NATIVE_CLIPBOARD_CXX32'
    }
)
New-Item -ItemType Directory -Path $toolRoot -Force | Out-Null
foreach ($toolchain in $toolchains) {
    $archive = Join-Path $toolRoot $toolchain.Asset
    Invoke-WebRequest -Uri "$releaseUrl/$($toolchain.Asset)" -OutFile $archive
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $toolchain.Sha256) {
        throw "Compiler archive digest mismatch: $($toolchain.Asset)"
    }
    & $archiveTool x $archive "-o$toolRoot" -y -bso0
    if ($LASTEXITCODE -ne 0) { throw 'Compiler extraction failed.' }
    $compiler = Join-Path $toolRoot "$($toolchain.Directory)/bin/g++.exe"
    $target = & $compiler -dumpmachine
    if ($LASTEXITCODE -ne 0 -or $target.Trim() -ne $toolchain.Target) {
        throw "Compiler target mismatch: $($toolchain.Directory)"
    }
    "$($toolchain.Variable)=$compiler" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
}
