param(
  [string]$SourcePath = (Join-Path $PSScriptRoot "..\build\icon-source.png"),
  [string]$OutputPath = (Join-Path $PSScriptRoot "..\build\icon.png")
)

Add-Type -AssemblyName System.Drawing

$directory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $directory | Out-Null

$source = [System.Drawing.Bitmap]::new((Resolve-Path -LiteralPath $SourcePath).Path)
$cropSize = [Math]::Min($source.Width, $source.Height)
$cropX = [Math]::Floor(($source.Width - $cropSize) / 2)
$cropY = [Math]::Floor(($source.Height - $cropSize) / 2)
$sourceRectangle = [System.Drawing.Rectangle]::new($cropX, $cropY, $cropSize, $cropSize)

$bitmap = [System.Drawing.Bitmap]::new(1024, 1024, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
$graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$graphics.DrawImage($source, [System.Drawing.Rectangle]::new(0, 0, 1024, 1024), $sourceRectangle, [System.Drawing.GraphicsUnit]::Pixel)

$bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)

$graphics.Dispose()
$bitmap.Dispose()
$source.Dispose()
