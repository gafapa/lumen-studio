$ErrorActionPreference='Stop'
# Registro de actividad durante una grabación: clics con posición y ventana activa, movimiento del
# ratón y ráfagas de teclado. Por privacidad nunca se registra qué teclas se pulsan, solo cuándo.
# Escribe una línea JSON por evento en stdout; termina cuando el proceso padre lo detiene.
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class LumenInputLog {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  static string Title() { var sb = new StringBuilder(256); GetWindowText(GetForegroundWindow(), sb, 256); return sb.ToString().Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", " ").Replace("\r", " "); }
  static string N(double v) { return v.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture); }
  public static void Run(int maxSeconds) {
    SetProcessDPIAware();
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = Math.Max(1, GetSystemMetrics(78)), vh = Math.Max(1, GetSystemMetrics(79));
    Console.Out.WriteLine("{\"type\":\"screen\",\"epoch\":" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + ",\"x\":" + vx + ",\"y\":" + vy + ",\"width\":" + vw + ",\"height\":" + vh + "}"); Console.Out.Flush();
    var clock = Stopwatch.StartNew(); bool[] mouse = new bool[3]; int[] buttons = { 0x01, 0x02, 0x04 }; string[] names = { "left", "right", "middle" };
    bool[] keys = new bool[256]; double burstStart = -1, burstEnd = -1; int burstCount = 0; double lastMove = -10; int lx = int.MinValue, ly = int.MinValue;
    while (clock.Elapsed.TotalSeconds < maxSeconds) {
      double t = clock.Elapsed.TotalSeconds; POINT p; GetCursorPos(out p);
      double nx = (p.X - vx) / (double)vw, ny = (p.Y - vy) / (double)vh;
      for (int i = 0; i < 3; i++) { bool down = (GetAsyncKeyState(buttons[i]) & 0x8000) != 0; if (down && !mouse[i]) { Console.Out.WriteLine("{\"type\":\"click\",\"t\":" + N(t) + ",\"x\":" + N(nx) + ",\"y\":" + N(ny) + ",\"button\":\"" + names[i] + "\",\"window\":\"" + Title() + "\"}"); Console.Out.Flush(); } mouse[i] = down; }
      if ((Math.Abs(p.X - lx) > 4 || Math.Abs(p.Y - ly) > 4) && t - lastMove > 0.25) { Console.Out.WriteLine("{\"type\":\"move\",\"t\":" + N(t) + ",\"x\":" + N(nx) + ",\"y\":" + N(ny) + "}"); Console.Out.Flush(); lastMove = t; lx = p.X; ly = p.Y; }
      int pressed = 0; for (int k = 0x08; k < 0xFF; k++) { if (k <= 0x06) continue; bool down = (GetAsyncKeyState(k) & 0x8000) != 0; if (down && !keys[k]) pressed++; keys[k] = down; }
      if (pressed > 0) { if (burstStart < 0 || t - burstEnd > 1.5) { if (burstStart >= 0) { Console.Out.WriteLine("{\"type\":\"keys\",\"t\":" + N(burstStart) + ",\"end\":" + N(burstEnd) + ",\"count\":" + burstCount + "}"); Console.Out.Flush(); } burstStart = t; burstCount = 0; } burstEnd = t; burstCount += pressed; }
      else if (burstStart >= 0 && t - burstEnd > 1.5) { Console.Out.WriteLine("{\"type\":\"keys\",\"t\":" + N(burstStart) + ",\"end\":" + N(burstEnd) + ",\"count\":" + burstCount + "}"); Console.Out.Flush(); burstStart = -1; }
      Thread.Sleep(30);
    }
  }
}
'@
$max=if($args.Count -gt 0){[int]$args[0]}else{330}
[LumenInputLog]::Run($max)
