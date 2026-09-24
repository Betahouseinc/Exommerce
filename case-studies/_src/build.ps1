# Renders each case-study HTML in this folder to ../<name>.pdf with headless
# Chrome. Run from anywhere:  powershell -File case-studies\_src\build.ps1
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$src = $PSScriptRoot
$out = Split-Path $src -Parent

Get-ChildItem $src -Filter *.html | ForEach-Object {
  $pdf = Join-Path $out ($_.BaseName + ".pdf")
  $url = "file:///" + ($_.FullName -replace '\\', '/')
  & $chrome --headless=new --disable-gpu --no-pdf-header-footer --virtual-time-budget=8000 "--print-to-pdf=$pdf" $url | Out-Null
  Write-Output ("{0}  {1:N0} KB" -f $pdf, ((Get-Item $pdf).Length / 1KB))
}
