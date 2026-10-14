$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'VerificationForm.cs'
$output = Join-Path $PSScriptRoot 'ComputerUseVerification.exe'
if ((-not (Test-Path -LiteralPath $output)) -or ((Get-Item -LiteralPath $source).LastWriteTimeUtc -gt (Get-Item -LiteralPath $output).LastWriteTimeUtc)) {
    Add-Type -Path $source -ReferencedAssemblies 'System.Windows.Forms', 'System.Drawing' -OutputAssembly $output -OutputType WindowsApplication
}
Start-Process -FilePath $output
Write-Output 'Started the isolated Computer Use verification window.'
