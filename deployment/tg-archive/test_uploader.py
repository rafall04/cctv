"""
Tes untuk logika baru di uploader.py: klasifikasi kegagalan dan deteksi macet.

Kenapa berkas ini ada: sebelum ini uploader tidak punya tes sama sekali, dan perubahan yang
dibuat menyangkut satu keputusan yang salahnya tidak kelihatan — memajukan watermark melewati
segmen yang sebenarnya cuma gagal sementara berarti rekaman itu HILANG dari arsip selamanya,
tanpa error, tanpa jejak. Jalankan: python3 test_uploader.py
"""
import sys
import types
import unittest
from unittest import mock

# Muat uploader.py sebagai modul tanpa menjalankan main().
import importlib.util
spec = importlib.util.spec_from_file_location('uploader', 'uploader.py')
uploader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uploader)


class KlasifikasiKegagalan(unittest.TestCase):
    """4xx = permintaannya yang salah (maju). Sisanya = pihak sana yang gagal (tahan)."""

    def test_4xx_permanen(self):
        for err in ['400 Bad Request', '403 bot was kicked from the group chat',
                    '404 chat not found', '413 Request Entity Too Large']:
            self.assertTrue(uploader.is_permanent_failure(err), err)

    def test_429_bukan_permanen(self):
        # Rate limit adalah jawaban paling layak-ulang yang ada.
        self.assertFalse(uploader.is_permanent_failure('429 Too Many Requests'))

    def test_rate_limit_bergaya_400_dari_bot_api_lokal_bukan_permanen(self):
        """String INI diambil apa adanya dari log produksi, bukan dikarang.

        Bot API resmi mengirim rate limit sebagai 429. Bot API LOKAL yang dipakai instalasi ini
        mengirimnya sebagai 400. Diukur di produksi 25 Agustus 2026: 520 rate limit dalam 24 jam,
        SEMUANYA bergaya 400, nol yang 429. Menggolongkannya permanen berarti melangkahi sekitar
        1 dari 10 rekaman secara diam-diam — dan Telegram satu-satunya salinan yang bertahan
        lebih lama dari retensi disk.
        """
        for err in [
            '400 Bad Request: too Many Requests: retry after 8',
            '400 Bad Request: Too Many Requests: retry after 12',
            '429 Too Many Requests: retry after 3',
        ]:
            self.assertFalse(uploader.is_permanent_failure(err), err)

    def test_400_yang_BUKAN_rate_limit_tetap_permanen(self):
        # Pengaman arah sebaliknya: jangan sampai perbaikan di atas membuat semua 400
        # ikut ditahan selamanya.
        for err in ['400 Bad Request: chat not found',
                    '400 Bad Request: file is too big']:
            self.assertTrue(uploader.is_permanent_failure(err), err)


    def test_galat_server_berbungkus_400_bukan_permanen(self):
        """Diambil dari log produksi: 5 kejadian per 24 jam.

        Kode statusnya 400 tetapi deskripsinya mengaku galat sisi server. Kode status berbohong
        tentang siapa yang salah; deskripsinya jujur. Aturan dokumen ini sendiri: 5xx = coba lagi.
        """
        for err in ['400 Bad Request: internal Server Error during file upload',
                    '400 Bad Request: Bad Gateway']:
            self.assertFalse(uploader.is_permanent_failure(err), err)

    def test_5xx_bukan_permanen(self):
        for err in ['500 Internal Server Error', '502 Bad Gateway',
                    '503 Service Unavailable', '504 Gateway Timeout']:
            self.assertFalse(uploader.is_permanent_failure(err), err)

    def test_yang_tidak_dikenali_dianggap_bisa_diulang(self):
        # Inti aturannya: salah ke arah "tahan" biayanya macet yang terbatas dan ada alarmnya;
        # salah ke arah "maju" biayanya rekaman hilang diam-diam. Jadi default-nya menahan.
        for err in ['non-JSON response: <html>502 gateway</html>', 'Connection timed out',
                    '', None, 'sesuatu yang aneh']:
            self.assertFalse(uploader.is_permanent_failure(err), repr(err))


class BacaRetryAfter(unittest.TestCase):
    """Tahu harus menunggu berapa lama, dari field terstruktur ATAU dari kalimatnya."""

    def test_dari_field_terstruktur(self):
        self.assertEqual(uploader.retry_after_seconds({'retry_after': 7}, ''), 7)

    def test_dari_deskripsi_gaya_bot_api_lokal(self):
        self.assertEqual(
            uploader.retry_after_seconds({}, 'Bad Request: too Many Requests: retry after 8'), 8)

    def test_field_menang_atas_deskripsi(self):
        self.assertEqual(
            uploader.retry_after_seconds({'retry_after': 3}, 'retry after 99'), 3)

    def test_tanpa_keduanya_mengembalikan_None(self):
        for params, desc in [({}, 'chat not found'), ({}, ''), (None, None)]:
            self.assertIsNone(uploader.retry_after_seconds(params, desc))

class DeteksiMacet(unittest.TestCase):
    def setUp(self):
        self.cfg = types.SimpleNamespace(stall_alert_min=20.0, alert_chat_id=None)
        self.log = mock.Mock()
        self.seg = {'id': 100, 'camera_id': 7}

    def test_macet_pertama_belum_beralarm(self):
        stall = uploader.note_stall(self.cfg, None, self.seg, 5, self.log)
        self.assertEqual(stall['seg_id'], 100)
        self.assertFalse(stall['alerted'])
        self.log.error.assert_not_called()

    def test_alarm_setelah_ambang_terlewat(self):
        stall = uploader.note_stall(self.cfg, None, self.seg, 5, self.log)
        stall['since'] -= 21 * 60          # seolah tertahan 21 menit
        stall = uploader.note_stall(self.cfg, stall, self.seg, 5, self.log)

        self.assertTrue(stall['alerted'])
        self.log.error.assert_called_once()
        self.assertIn('ARCHIVE STALLED', self.log.error.call_args[0][0])

    def test_alarm_hanya_SEKALI_meski_dipoll_terus(self):
        # Arsip yang macet dipoll tiap 60 detik. Satu alarm per poll akan mengubur satu
        # baris yang penting — kesalahan yang sudah pernah dibayar proyek ini di log backend.
        stall = uploader.note_stall(self.cfg, None, self.seg, 5, self.log)
        stall['since'] -= 21 * 60
        for _ in range(10):
            stall = uploader.note_stall(self.cfg, stall, self.seg, 5, self.log)
        self.log.error.assert_called_once()

    def test_pindah_segmen_mereset_hitungan(self):
        stall = uploader.note_stall(self.cfg, None, self.seg, 5, self.log)
        stall['since'] -= 21 * 60
        lain = uploader.note_stall(self.cfg, stall, {'id': 101, 'camera_id': 7}, 5, self.log)

        self.assertEqual(lain['seg_id'], 101)
        self.assertFalse(lain['alerted'])
        self.log.error.assert_not_called()

    def test_blip_singkat_tidak_beralarm(self):
        # Segmen yang masih ditulis mengembalikan False juga; ambang 20 menit = 2x panjang
        # segmen supaya kondisi normal itu tidak pernah memicu apa pun.
        stall = uploader.note_stall(self.cfg, None, self.seg, 5, self.log)
        stall['since'] -= 5 * 60
        stall = uploader.note_stall(self.cfg, stall, self.seg, 5, self.log)
        self.assertFalse(stall['alerted'])
        self.log.error.assert_not_called()


class PemulihanMacet(unittest.TestCase):
    def setUp(self):
        self.cfg = types.SimpleNamespace(stall_alert_min=20.0, alert_chat_id=None)
        self.log = mock.Mock()

    def test_pulih_tanpa_alarm_tetap_diam(self):
        stall = {'seg_id': 100, 'since': 0, 'alerted': False}
        self.assertIsNone(uploader.clear_stall(self.cfg, stall, self.log))
        self.log.info.assert_not_called()

    def test_pulih_setelah_beralarm_mengumumkan_sekali(self):
        # Pesan pemulihan justru yang PALING mungkin sampai — alarm macetnya bisa jadi tidak.
        import time
        stall = {'seg_id': 100, 'since': time.time() - 1800, 'alerted': True}
        self.assertIsNone(uploader.clear_stall(self.cfg, stall, self.log))
        self.log.info.assert_called_once()
        self.assertIn('recovered', self.log.info.call_args[0][0])

    def test_tanpa_macet_bukan_error(self):
        self.assertIsNone(uploader.clear_stall(self.cfg, None, self.log))


class AlarmTidakBolehMembekukanLoop(unittest.TestCase):
    def test_tanpa_chat_id_tidak_ada_permintaan_jaringan(self):
        cfg = types.SimpleNamespace(alert_chat_id=None)
        with mock.patch.object(uploader.requests, 'post') as post:
            uploader.send_alert(cfg, 'halo', mock.Mock())
        post.assert_not_called()

    def test_pakai_timeout_pendek_bukan_timeout_unggahan(self):
        # cfg.timeout untuk unggahan = 1800 detik. Alarm yang memakai itu bisa membekukan
        # loop setengah jam demi pesan yang tak seorang pun menunggu.
        cfg = types.SimpleNamespace(alert_chat_id='-100', api=lambda m: 'http://x/' + m)
        with mock.patch.object(uploader.requests, 'post') as post:
            uploader.send_alert(cfg, 'halo', mock.Mock())
        self.assertEqual(post.call_args.kwargs['timeout'], 15)

    def test_kegagalan_alarm_tidak_melempar(self):
        cfg = types.SimpleNamespace(alert_chat_id='-100', api=lambda m: 'http://x/' + m)
        log = mock.Mock()
        with mock.patch.object(uploader.requests, 'post',
                               side_effect=uploader.requests.RequestException('mati')):
            uploader.send_alert(cfg, 'halo', log)   # tidak boleh melempar
        log.warning.assert_called_once()


if __name__ == '__main__':
    unittest.main(verbosity=2, exit=False, argv=[sys.argv[0]])
