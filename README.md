# Sile

A modern file transfer client for Windows and Linux, built as a free and open alternative to FileZilla.

Sile connects to FTP, FTPS and SFTP servers through a dual-pane interface and adds features traditional clients do not offer: built-in previews for images, video and audio, a PDF viewer, a code editor with syntax highlighting for more than 25 languages, an SSH terminal, recursive folder size calculation, and a command palette.

Built with Tauri 2 (Rust) and React, styled after Google's Material 3 design language with Lucide icons.

## Features

### Transfer
- Dual-pane browser: local filesystem on the left, remote server on the right
- FTP, FTPS (TLS certificate validation always enforced) and SFTP
- Drag and drop in both directions, including files dragged from the operating system
- Transfer queue with live speed, ETA and per-file progress; pause, resume and retry
- Recursive directory transfers and local-to-local copying
- Folder comparison and selective synchronisation between panes

### Preview and editing
- Tabbed previews: images (zoom, pan, rotate), video and audio with custom player controls, PDF rendering, Markdown, and hex dumps for binary files
- Code editor (CodeMirror 6) with syntax highlighting for 25+ languages, multiple tabs, search and replace, and saving directly back to the server
- Text files open directly in the editor; media opens in preview tabs

### Productivity
- Site manager with passwords encrypted using AES-256-GCM; connect to saved sites without retyping passwords
- Quick connect bar with a saved-sites menu
- Command palette (Ctrl+K) and keyboard shortcuts
- Light and dark themes with ten selectable accent colours
- Recursive remote search, permission (chmod) editor with recursive mode, MD5/SHA-256 checksums
- Details and grid views with real image thumbnails, recursive folder sizes, filtering and sortable columns
- Connection proxy support: SOCKS5, SOCKS4 and HTTP CONNECT, configurable in Settings

## Requirements

- Windows 10 or later (64-bit), or a Linux distribution with WebKitGTK 4.1
- For building: Node.js 18+, a Rust toolchain, and the platform prerequisites listed below

## Install

Download `Sile-Setup.exe` from the releases page and run it. The installer does not require administrator rights and registers an uninstaller.

### Build from source (Windows)

```bat
npm install
npm run tauri build
```

The installer is written to `src-tauri/target/release/bundle/nsis/`. A portable executable is available at `src-tauri/target/release/sile.exe`; it requires `WebView2Loader.dll` in the same directory.

### Build from source (Linux)

```bash
sudo apt install build-essential libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
npm install
npm run tauri build
```

Outputs: `src-tauri/target/release/bundle/deb/` and `src-tauri/target/release/bundle/appimage/`.

## Development

```bash
npm install
npm run tauri dev
```

## Project structure

```
src/               React + TypeScript frontend
  components/      File panes, dialogs, preview, editor, terminal, command palette
  lib/             Tauri API bindings, state store, drag engine, dialogs
src-tauri/         Rust backend
  src/conn.rs      Connection layer: FTP/FTPS (suppaftp), SFTP (russh), local filesystem
  src/transfer.rs  Transfer engine with progress events and cancellation
  src/sites.rs     Site storage with AES-256-GCM encrypted passwords
  src/proxy.rs     SOCKS4/5 and HTTP CONNECT proxy support
  src/terminal.rs  SSH PTY terminal over the SFTP session
  e2e/             Standalone end-to-end test crate (no tauri dependencies)
```

## Testing

The `e2e` crate exercises the real connection layer without launching the GUI:

```bash
cd src-tauri/e2e
PROBE_HOST=example.com PROBE_PORT=22 PROBE_USER=user PROBE_PASS=secret cargo run
```

The test verifies connect, list, mkdir, write, read, rename, stat, recursive delete and local filesystem helpers against a live server.

## Security notes

- Site passwords are encrypted with AES-256-GCM using a machine-local random key.
- FTPS always validates TLS certificates against the system trust store; self-signed certificates are rejected.
- SFTP host keys are accepted on first connection. As with any first-time SSH connection, verify the server fingerprint out of band.

## License

Released under the [MIT License](LICENSE).

---

## Sile — نسخه فارسی

کلاینت انتقال فایل مدرن برای ویندوز و لینوکس، به‌عنوان جایگزینی آزاد و متن‌باز برای FileZilla.

Sile از طریق رابط دو پنله به سرورهای FTP، FTPS و SFTP متصل می‌شود و امکاناتی را ارائه می‌دهد که کلاینت‌های سنتی ندارند: پیش‌نمایش داخلی تصاویر، ویدیو و صدا، نمایشگر PDF، ویرایشگر کد با برجسته‌سازی نحوی برای بیش از ۲۵ زبان، ترمینال SSH، محاسبه بازگشتی حجم پوشه‌ها و پالت دستورات.

این برنامه با Tauri 2 (Rust) و React ساخته شده و از زبان طراحی Material 3 گوگل با آیکون‌های Lucide پیروی می‌کند.

### امکانات

انتقال فایل
- مرورگر دو پنله: فایل‌سیستم محلی در سمت چپ، سرور در سمت راست
- پشتیبانی از FTP، FTPS (اعتبارسنجی گواهی TLS همیشه فعال است) و SFTP
- کشیدن و رها کردن در هر دو جهت، شامل فایل‌های کشیده‌شده از سیستم‌عامل
- صف انتقال با سرعت زنده، زمان تخمینی و پیشرفت هر فایل؛ توقف، ادامه و تلاش مجدد
- انتقال بازگشتی پوشه‌ها و کپی محلی به محلی
- مقایسه پوشه‌ها و همگام‌سازی انتخابی بین دو پنل

پیش‌نمایش و ویرایش
- پیش‌نمایش‌های تب‌شکل: تصاویر (بزرگ‌نمایی، جابه‌جایی، چرخش)، ویدیو و صدا با کنترل‌های اختصاصی، نمایش PDF، مارک‌داون و نمای hex برای فایل‌های باینری
- ویرایشگر کد (CodeMirror 6) با برجسته‌سازی نحوی بیش از ۲۵ زبان، تب‌های چندگانه، جست‌وجو و جایگزینی و ذخیره مستقیم روی سرور
- فایل‌های متنی مستقیماً در ویرایشگر باز می‌شوند؛ فایل‌های چندرسانه‌ای در تب پیش‌نمایش

بهره‌وری
- مدیریت سایت با رمزهای عبور رمزنگاری‌شده با AES-256-GCM؛ اتصال به سایت‌های ذخیره‌شده بدون تکرار رمز
- نوار اتصال سریع با فهرست سایت‌های ذخیره‌شده
- پالت دستورات (Ctrl+K) و میان‌برهای صفحه‌کلید
- تم روشن و تاریک با ده رنگ تأکیدی قابل انتخاب
- جست‌وجوی بازگشتی سرور، ویرایشگر مجوزها (chmod) با حالت بازگشتی، checksum با MD5/SHA-256
- نمای جزئیات و شبکه‌ای با بندانگشتی واقعی تصاویر، حجم بازگشتی پوشه‌ها، فیلتر و ستون‌های قابل مرتب‌سازی
- پشتیبانی از پروکسی: SOCKS5، SOCKS4 و HTTP CONNECT از طریق تنظیمات

### نیازمندی‌ها

- ویندوز ۱۰ یا بالاتر (۶۴ بیت) یا توزیع لینوکس دارای WebKitGTK 4.1
- برای ساخت: Node.js نسخه ۱۸ به بالا، Toolchain Rust و پیش‌نیازهای پلتفرم

### نصب

فایل `Sile-Setup.exe` را از صفحه Releases دریافت و اجرا کنید. نصب به دسترسی مدیر نیاز ندارد و حذف نصب در سیستم ثبت می‌شود.

### ساخت از سورس (ویندوز)

```bat
npm install
npm run tauri build
```

نصب‌کننده در مسیر `src-tauri/target/release/bundle/nsis/` ساخته می‌شود. نسخه پرتابل در `src-tauri/target/release/sile.exe` قرار دارد و به فایل `WebView2Loader.dll` در کنار خود نیاز دارد.

### ساخت از سورس (لینوکس)

```bash
sudo apt install build-essential libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
npm install
npm run tauri build
```

خروجی‌ها در `src-tauri/target/release/bundle/deb/` و `src-tauri/target/release/bundle/appimage/` قرار می‌گیرند.

### توسعه

```bash
npm install
npm run tauri dev
```

### ساختار پروژه

```
src/               فرانت‌اند React + TypeScript
  components/      پنل‌های فایل، دیالوگ‌ها، پیش‌نمایش، ویرایشگر، ترمینال، پالت دستورات
  lib/             اتصال به API تاری، مدیریت State، موتور درگ، دیالوگ‌ها
src-tauri/         بک‌اند Rust
  src/conn.rs      لایه اتصال: FTP/FTPS (suppaftp)، SFTP (russh)، فایل‌سیستم محلی
  src/transfer.rs  موتور انتقال با رویدادهای پیشرفت و لغو
  src/sites.rs     ذخیره سایت‌ها با رمزنگاری AES-256-GCM
  src/proxy.rs     پشتیبانی پروکسی SOCKS4/5 و HTTP CONNECT
  src/terminal.rs  ترمینال PTY روی نشست SFTP
  e2e/             کرت تست انتها-به-انتها (بدون وابستگی به tauri)
```

### تست

کرت `e2e` لایه اتصال واقعی را بدون اجرای رابط گرافیکی آزمایش می‌کند:

```bash
cd src-tauri/e2e
PROBE_HOST=example.com PROBE_PORT=22 PROBE_USER=user PROBE_PASS=secret cargo run
```

این تست اتصال، لیست‌کردن، ساخت پوشه، نوشتن، خواندن، تغییر نام، stat، حذف بازگشتی و توابع فایل‌سیستم محلی را روی سرور واقعی بررسی می‌کند.

### نکات امنیتی

- رمزهای عبور با AES-256-GCM و کلید تصادفی محلیِ ماشین رمزنگاری می‌شوند.
- FTPS همیشه گواهی TLS را با trust store سیستم اعتبارسنجی می‌کند؛ گواهی self-signed رد می‌شود.
- کلید میزبان SFTP در اولین اتصال پذیرفته می‌شود؛ مانند هر اتصال SSH، اثر انگشت سرور را به‌صورت مستقل بررسی کنید.

### مجوز

این پروژه تحت [مجوز MIT](LICENSE) منتشر شده است.
