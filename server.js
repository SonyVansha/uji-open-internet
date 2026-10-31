// Service uji untuk test case "Akses internet environment (egress)".
// Tanpa dependency, butuh Node 18+.
//
// Env opsional:
//   EXTERNAL_URL  URL eksternal yang dipanggil (default https://example.com)
//   INTERNAL_URL  URL service LAIN di environment yang sama (untuk tes traffic internal)
//   PORT          port HTTP (default 3000)

const http = require("http");
const dns = require("dns").promises;
const net = require("net");

const PORT = process.env.PORT || 3000;
const EXTERNAL_URL = process.env.EXTERNAL_URL || "https://example.com";
const INTERNAL_URL = process.env.INTERNAL_URL || "";
const started = Date.now();

async function timed(fn) {
  const t = Date.now();
  try {
    const info = await fn();
    return { ok: true, ms: Date.now() - t, info };
  } catch (e) {
    return { ok: false, ms: Date.now() - t, error: (e.cause && e.cause.code) || e.code || e.name || String(e) };
  }
}

const getUrl = (url, ms = 5000) =>
  timed(async () => {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return "HTTP " + r.status;
  });

const tcp = (host, port, ms = 3000) =>
  timed(
    () =>
      new Promise((resolve, reject) => {
        const s = net.connect({ host, port, timeout: ms });
        s.on("connect", () => { s.destroy(); resolve("tersambung"); });
        s.on("timeout", () => { s.destroy(); reject(new Error("timeout")); });
        s.on("error", reject);
      })
  );

async function probe(extra) {
  const r = {
    waktu: new Date().toISOString(),
    uptime_detik: Math.round((Date.now() - started) / 1000), // kalau reset ke 0 = service restart
    dns: await timed(async () => (await dns.lookup("example.com")).address),
    eksternal: await getUrl(EXTERNAL_URL),
  };
  if (INTERNAL_URL) r.internal = await getUrl(INTERNAL_URL);
  if (extra) {
    // Selalu ditolak menurut dokumentasi, baik Terbuka maupun Tertutup
    r.ip_privat_192_168_1_1 = await tcp("192.168.1.1", 80);
    r.port_25_smtp = await tcp("smtp.gmail.com", 25);
  }
  return r;
}

// Log otomatis tiap ~3 detik supaya perubahan terlihat tanpa menekan apa pun
const mark = (x) => (x ? (x.ok ? `OK(${x.ms}ms)` : `GAGAL(${x.ms}ms,${x.error})`) : "-");
(async function loop() {
  const r = await probe(false);
  console.log(
    `${r.waktu} up=${r.uptime_detik}s dns=${mark(r.dns)} eksternal=${mark(r.eksternal)}` +
      (INTERNAL_URL ? ` internal=${mark(r.internal)}` : "")
  );
  setTimeout(loop, 3000);
})();

http
  .createServer(async (req, res) => {
    const extra = new URL(req.url, "http://x").searchParams.get("extra") === "1";
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(await probe(extra), null, 2));
  })
  .listen(PORT, () => console.log(`egress-probe jalan di port ${PORT}`));
