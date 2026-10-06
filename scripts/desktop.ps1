$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LumenDesktop {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION value; }
    [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION {
      [FieldOffset(0)] public MOUSEINPUT mouse;
      [FieldOffset(0)] public KEYBDINPUT keyboard;
    }
    [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx,dy; public uint mouseData,dwFlags,time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort vk,scan; public uint flags,time; public UIntPtr extra; }
    public static void TypeText(string text) {
      foreach(char c in text) {
        INPUT down = new INPUT { type=1, value=new INPUTUNION { keyboard=new KEYBDINPUT { scan=c,flags=4 } } };
        INPUT up = down; up.value.keyboard.flags=6;
        if(SendInput(2,new INPUT[]{down,up},Marshal.SizeOf(typeof(INPUT)))!=2)throw new Exception("No se ha podido escribir en la ventana activa.");
      }
    }
}
'@
[LumenDesktop]::SetProcessDPIAware() | Out-Null
$screen = [Windows.Forms.Screen]::PrimaryScreen.Bounds
switch ($request.action) {
    'screenshot' {
        $bitmap = [Drawing.Bitmap]::new($screen.Width,$screen.Height)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        try { $graphics.CopyFromScreen($screen.Left,$screen.Top,0,0,$screen.Size); $bitmap.Save($request.output,[Drawing.Imaging.ImageFormat]::Png) }
        finally { $graphics.Dispose(); $bitmap.Dispose() }
    }
    'click' {
        if ($request.x -lt 0 -or $request.y -lt 0 -or $request.x -ge $screen.Width -or $request.y -ge $screen.Height) { throw 'Coordenadas fuera de la pantalla.' }
        [LumenDesktop]::SetCursorPos([int]$request.x,[int]$request.y) | Out-Null
        [LumenDesktop]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
        [LumenDesktop]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
    }
    'type' { [LumenDesktop]::TypeText([string]$request.text) }
    'key' {
        $keys = @{ ENTER=13; TAB=9; ESC=27; SPACE=32; LEFT=37; UP=38; RIGHT=39; DOWN=40; HOME=36; END=35; BACKSPACE=8; L=76; A=65; C=67; V=86; F=70; F5=116 }
        $parts = ([string]$request.key).ToUpperInvariant().Split('+')
        $keyName = $parts[-1]
        if (-not $keys.ContainsKey($keyName)) { throw 'Tecla no admitida.' }
        $control = $parts.Count -eq 2 -and $parts[0] -eq 'CTRL'
        if ($parts.Count -gt 1 -and -not $control) { throw 'Combinacion no admitida.' }
        if ($control) { [LumenDesktop]::keybd_event(17,0,0,[UIntPtr]::Zero) }
        [LumenDesktop]::keybd_event([byte]$keys[$keyName],0,0,[UIntPtr]::Zero)
        [LumenDesktop]::keybd_event([byte]$keys[$keyName],0,2,[UIntPtr]::Zero)
        if ($control) { [LumenDesktop]::keybd_event(17,0,2,[UIntPtr]::Zero) }
    }
    default { throw 'Accion desconocida.' }
}
@{width=$screen.Width;height=$screen.Height;ok=$true} | ConvertTo-Json -Compress
