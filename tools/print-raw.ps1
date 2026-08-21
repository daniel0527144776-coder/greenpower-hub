<#
  Sends a file of bytes to a Windows printer queue untouched.

  This is the BENCH path, not the product. Daniel's phone will talk Bluetooth straight to the
  XP-TT434B and Windows will not be involved at all — but the printer is on this machine's
  USB002 today, so this is how the TSPL that test-tspl.mjs generates gets proved against real
  ribbon before any of it ships. If the label that comes out of here is right, the same bytes
  over Bluetooth are right.

  Out-Printer and `print` both render THROUGH the driver, which would take our finished raster
  and lay it out on a page again. WritePrinter with datatype RAW is the one path that hands the
  bytes to the port as they are; winprint (this queue's print processor) passes RAW through.

  Usage:
    powershell -File print-raw.ps1 -PrinterName "Xprinter XP-TT434B" -Path label.bin
#>
param(
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$JobName = "GP label"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Path)) { throw "no such file: $Path" }
$bytes = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $Path))
if ($bytes.Length -eq 0) { throw "refusing to send an empty job" }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class RawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DOCINFO {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern int StartDocPrinter(IntPtr hPrinter, int level, ref DOCINFO di);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int count, out int written);

    public static int Send(string printer, byte[] data, string jobName) {
        IntPtr h;
        if (!OpenPrinter(printer, out h, IntPtr.Zero))
            throw new Exception("OpenPrinter failed: " + Marshal.GetLastWin32Error());
        try {
            DOCINFO di = new DOCINFO();
            di.pDocName = jobName;
            di.pDataType = "RAW";
            if (StartDocPrinter(h, 1, ref di) == 0)
                throw new Exception("StartDocPrinter failed: " + Marshal.GetLastWin32Error());
            try {
                if (!StartPagePrinter(h))
                    throw new Exception("StartPagePrinter failed: " + Marshal.GetLastWin32Error());
                IntPtr buf = Marshal.AllocCoTaskMem(data.Length);
                try {
                    Marshal.Copy(data, 0, buf, data.Length);
                    int written;
                    if (!WritePrinter(h, buf, data.Length, out written))
                        throw new Exception("WritePrinter failed: " + Marshal.GetLastWin32Error());
                    return written;
                } finally {
                    Marshal.FreeCoTaskMem(buf);
                    EndPagePrinter(h);
                }
            } finally {
                EndDocPrinter(h);
            }
        } finally {
            ClosePrinter(h);
        }
    }
}
'@

$written = [RawPrinter]::Send($PrinterName, $bytes, $JobName)
if ($written -ne $bytes.Length) {
  throw "short write: the spooler took $written of $($bytes.Length) bytes"
}
"sent $written bytes to '$PrinterName'"
