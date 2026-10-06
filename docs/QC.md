# Quality control CSM

Panduan uji untuk fitur yang sudah dibangun. Jalankan bagian **A** setiap kali ada perubahan kode; bagian **B** sebelum demo,
rilis, atau setelah perubahan besar. Setiap butir punya hasil yang diharapkan — tandai ✅/❌ dan catat temuan.

## Persiapan

1. Docker Desktop menyala. Dari folder proyek: `npm run local` (tunggu "CSM berjalan → http://localhost:3000").
2. Buka **Chrome atau Safari** (bukan panel browser di aplikasi lain — kamera diblokir di sana): http://localhost:3000.
3. Akun: Super Admin & Admin dari `SEED_*` di `.env`; buat satu Sales uji lewat **Kelola user**.
4. Untuk baca otomatis: `HF_TOKEN` terisi di `.env` dan `npm run local` dijalankan ulang setelah mengisinya.
5. Gunakan **resi contoh/fiktif** untuk uji. Foto resi asli dikirim ke penyedia model di luar negeri (perlu persetujuan PDP).

## A. Uji otomatis (± 1 menit)

```bash
npm run typecheck && npm test
```

```bash
npm run ml:test
```

Harus lulus semua: shared 16 · API 60 · ML 22. Test yang **dilewati (skipped)** berarti database belum menyala —
jalankan `npm run db:up` lalu ulangi. CI di GitHub menjalankan hal yang sama setiap push.

## B. Uji manual per fitur

### B1. Login & akun (PRD §3, F8a)

| # | Langkah | Hasil yang diharapkan |
| --- | --- | --- |
| 1 | Login dengan password salah | "Email atau password salah." |
| 2 | Login Super Admin | Masuk ke Container; bar atas "nama · Super Admin" |
| 3 | Kelola user → daftarkan Sales (password awal ≥ 8 karakter) | Baris baru, status Aktif |
| 4 | Login sebagai Admin → Kelola user | Baris Super Admin tertulis "Hanya dilihat"; pilihan role hanya Sales/Admin |
| 5 | Nonaktifkan Sales, lalu coba login sebagai Sales | Ditolak: akun dinonaktifkan |
| 6 | Klik Keluar, lalu buka /containers | Diarahkan ke halaman login |

### B2. Container (F4)

| # | Langkah | Hasil yang diharapkan |
| --- | --- | --- |
| 1 | Buat container, nomor box `txgu7181980` | Tersimpan sebagai "TXGU 7181980" |
| 2 | Buat container dengan nomor urut yang sudah ada | Ditolak dengan pesan |
| 3 | Mulai loading → Lock → (sebagai Admin) coba Unlock | Tombol Unlock hanya untuk Super Admin |
| 4 | Tutup container (Closed) | Muncul "foto & data pribadi dihapus [tanggal +30 hari]" |

### B3. Scan resi (F1) — utama

| # | Langkah | Hasil yang diharapkan |
| --- | --- | --- |
| 1 | Sebagai **Sales**, klik **Scan resi** di menu | Langsung ke halaman scan container Loading terbaru (atau Draft) |
| 2 | Izinkan kamera | Gambar kamera tampil dengan bingkai hijau A5; tulisan **tidak** terbalik |
| 3 | Pegang kertas resi di dalam bingkai, diam ± 1 detik (Otomatis: aktif) | Bingkai berubah warna "Tahan…", lalu foto diambil otomatis, bunyi "bip" |
| 4 | Biarkan kertas yang sama tetap di depan kamera | **Tidak** terfoto berulang; terfoto lagi setelah kertas diganti/diangkat |
| 5 | Matikan Otomatis, klik **Ambil foto** | Foto diambil manual |
| 6 | Ambil foto dalam gelap / goyang | Peringatan spesifik (gelap/buram/silau) + pilihan "Ulangi foto" / "Tetap pakai foto ini" |
| 7 | Foto 3 resi berturut-turut tanpa menunggu | Ketiganya masuk antrean; penghitung "… sedang diproses · … menunggu dicek"; kamera tetap aktif |
| 8 | Klik resi "Siap dicek" di antrean | Kanan: foto (bisa di-zoom) + form terisi otomatis, field kuning/merah + alasan |
| 9 | Ubah field kuning | Warnanya hilang |
| 10 | Lengkapi, klik **Simpan & scan berikutnya** | Status "Tersimpan", penghitung resi tersimpan naik, resi berikutnya terpilih |
| 11 | **Upload foto** beberapa file sekaligus dari galeri | Semua masuk antrean |
| 12 | Upload file yang sama dua kali dalam satu sesi | Yang kedua "Duplikat" + bunyi rendah dua kali; "duplikat diblokir" naik |
| 13 | Scan ulang kertas resi yang **sudah tersimpan** (foto baru) | Setelah dibaca: panel merah "Serial No … sudah di-scan · Container … · sales · oleh …, tanggal" |
| 14 | Di panel itu: **Ganti foto resi lama** | Resi lama mendapat foto versi baru; tidak ada resi ganda |
| 15 | Di panel itu: **Serial salah baca** | Form terbuka; ketik serial yang benar → bisa disimpan jika serial belum dipakai |
| 16 | Di panel itu: **Lewati** | Item "Dilewati"; foto sementara dibuang |
| 17 | `HF_TOKEN` dikosongkan / service ml mati | Form tetap muncul dengan pesan "Baca otomatis belum aktif… Isi form secara manual." |
| 18 | Sebagai Sales: lihat sheet container | Hanya resi miliknya; sales di form terkunci ke dirinya |
| 19 | Buka di HP (lebar ±375 px) | Tidak ada geser horizontal; menu satu baris; kamera layar penuh lebar |

### B4. Input manual, Serial ganda, alur status (F7, §7)

| # | Langkah | Hasil yang diharapkan |
| --- | --- | --- |
| 1 | Input manual resi dengan Serial No yang sudah ada | Panel merah duplikat saat diketik; tombol simpan terkunci |
| 2 | Paspor `E - 4499 715`, HP `0855… / 0852…`, HP pengirim `0560…` | Tersimpan sebagai `E4499715`, dua nomor dipisah spasi, HP Saudi diterima |
| 3 | Tujuan: ketik `Tlung Agung` | Saran **Tulungagung** |
| 4 | Koli 3, paket Drum 2 | Peringatan koli ≠ jumlah paket (tidak menolak) |
| 5 | Admin: Approve | Status Approved, kolom Cek "C" |
| 6 | Admin: Tolak dengan alasan → Sales perbaiki | Kembali "Dikirim ke Admin", alasan hilang |
| 7 | Pindah resi ke container Loading lain | Cek "Plus 1 (dari …)", "Dipindah dari Container …" |

### B5. Rekap, Audit, Statistik (F6, F8b, F8d)

| # | Langkah | Hasil yang diharapkan |
| --- | --- | --- |
| 1 | Container → tab **Rekap Sales** | Invoice/PCS/Kg per sales cocok dengan sheet; resi ditolak tidak dihitung |
| 2 | Menu **Audit** | Resi bermasalah di tab Tidak valid/Kurang valid dengan alasan; "Tandai diaudit" memindahkan ke Sudah diaudit |
| 3 | Menu **Statistik** per container/sales/hari | Resi unik; duplikat diblokir di kolom terpisah, tidak masuk total |

### B6. Keamanan & data (§12)

| # | Langkah | Hasil yang diharapkan |
| --- | --- | --- |
| 1 | Salin URL foto resi, buka lagi setelah 5 menit | Ditolak (tautan kedaluwarsa) |
| 2 | Ubah 1 huruf di parameter `sig` URL foto | Ditolak |
| 3 | Cek database: kolom `passport_no` | Isi terenkripsi (bukan teks paspor) |
| 4 | `git status` setelah uji | Tidak ada `.env`, `data/`, atau foto resi yang akan ter-commit |

## C. Setelah uji

- Hapus data uji (container/akun uji) atau jalankan `npm run local -- --reset` untuk mulai bersih
  (akun Super Admin & Admin dibuat ulang otomatis dari `.env`).
- Catat temuan: langkah, hasil yang terjadi, hasil yang diharapkan, browser/HP yang dipakai.

## D. Ukur akurasi baca resi asli

Butuh kunci jawaban yang dicek manusia dengan kertas asli. Semua file (foto, kunci, hasil) **di luar repo** —
`data/` sudah di-ignore. Foto resi asli dikirim ke penyedia model (persetujuan PDP).

1. Simpan foto per resi sebagai `data/eval/<nama>/img/<serial>.jpg`.
2. Tulis `data/eval/<nama>/kunci.json` (format di kepala `services/ml/src/csm_ml/evaluate.py`), cocokkan dengan kertas.
3. Jalankan (±10 dtk & ±USD 0,004 per resi):

```bash
set -a && source .env && set +a && uv run --directory services/ml python -m csm_ml.evaluate --images ../../data/eval/<nama>/img --labels ../../data/eval/<nama>/kunci.json --out ../../data/eval/<nama>/hasil
```

4. Baca `LAPORAN.md` (angka saja, boleh dibagikan) dan `selisih.md` (berisi data pribadi). Untuk setiap selisih,
   cek lagi kertasnya: kadang kunci yang salah. Gate Fase 0: semua field ≥ 80%, field angka ≥ 95%, ≥ 50 resi.

## Batasan yang diketahui (bukan bug)

- **Akurasi baca tulisan tangan asli baru diukur pada 1 resi** (kredit Hugging Face habis) — lihat bagian D.
- **Ambil otomatis** memakai deteksi ringan (kertas lebih terang dari alas + diam 0,6 detik), bukan deteksi 4 sudut
  OpenCV.js seperti PRD; di alas putih/terang bisa tidak terpicu — pakai tombol Ambil foto.
- **Baca Serial No cepat (≤ 1 detik)** belum ada: duplikat serial terdeteksi setelah baca penuh (± 10 detik).
- **Ambang kualitas foto** (buram/gelap/silau) belum dikalibrasi dengan resi asli.
- Login sementara memakai email + password (`AUTH_MODE=password`); kembali ke Google sebelum deploy online.
