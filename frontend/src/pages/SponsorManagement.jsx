import { useState, useEffect } from 'react';
import { useNotification } from '../contexts/NotificationContext';
import * as sponsorService from '../services/sponsorService';
import { TableSkeleton, StatCardSkeleton } from '../components/ui/Skeleton';

function SponsorManagement() {
    const { showNotification } = useNotification();
    const [sponsors, setSponsors] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        logo: '',
        url: '',
        package: 'bronze',
        price: 500000,
        active: true,
        contact_name: '',
        contact_email: '',
        contact_phone: '',
        start_date: new Date().toISOString().split('T')[0],
        end_date: '',
        notes: ''
    });

    const packages = {
        bronze: {
            name: 'Bronze',
            price: 500000,
            color: 'orange',
            features: ['Logo di 1 kamera', 'Mention di deskripsi', 'Link ke website']
        },
        silver: {
            name: 'Silver',
            price: 1500000,
            color: 'gray',
            features: ['Logo di 3 kamera', 'Banner di landing page', 'Social media mention', 'Dedicated page']
        },
        gold: {
            name: 'Gold',
            price: 3000000,
            color: 'yellow',
            features: ['Logo di semua kamera', 'Banner premium', 'Dedicated page', 'Social media promo', 'Monthly report']
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);
            const [sponsorsRes, statsRes] = await Promise.all([
                sponsorService.getAllSponsors(),
                sponsorService.getSponsorStats()
            ]);
            setSponsors(sponsorsRes.data);
            setStats(statsRes.data);
        } catch (error) {
            showNotification('Gagal memuat data sponsor', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            if (editingId) {
                await sponsorService.updateSponsor(editingId, formData);
                showNotification('Sponsor berhasil diperbarui', 'success');
            } else {
                await sponsorService.createSponsor(formData);
                showNotification('Sponsor berhasil ditambahkan', 'success');
            }
            setShowModal(false);
            resetForm();
            loadData();
        } catch (error) {
            showNotification(error.response?.data?.message || 'Gagal menyimpan sponsor', 'error');
        }
    };

    const handleEdit = (sponsor) => {
        setEditingId(sponsor.id);
        setFormData({
            name: sponsor.name || '',
            logo: sponsor.logo || '',
            url: sponsor.url || '',
            package: sponsor.package || 'bronze',
            price: sponsor.price || 500000,
            active: sponsor.active === 1,
            contact_name: sponsor.contact_name || '',
            contact_email: sponsor.contact_email || '',
            contact_phone: sponsor.contact_phone || '',
            start_date: sponsor.start_date || '',
            end_date: sponsor.end_date || '',
            notes: sponsor.notes || ''
        });
        setShowModal(true);
    };

    const handleDelete = async (id, name) => {
        if (!confirm(`Hapus sponsor "${name}"?`)) return;
        
        try {
            await sponsorService.deleteSponsor(id);
            showNotification('Sponsor berhasil dihapus', 'success');
            loadData();
        } catch (error) {
            showNotification('Gagal menghapus sponsor', 'error');
        }
    };

    const resetForm = () => {
        setEditingId(null);
        setFormData({
            name: '',
            logo: '',
            url: '',
            package: 'bronze',
            price: 500000,
            active: true,
            contact_name: '',
            contact_email: '',
            contact_phone: '',
            start_date: new Date().toISOString().split('T')[0],
            end_date: '',
            notes: ''
        });
    };

    const handlePackageChange = (pkg) => {
        setFormData({
            ...formData,
            package: pkg,
            price: packages[pkg].price
        });
    };

    if (loading) {
        return (
            <div className="p-6 space-y-6">
                {/* Stats Skeleton */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <StatCardSkeleton />
                    <StatCardSkeleton />
                    <StatCardSkeleton />
                </div>
                {/* Table Skeleton */}
                <TableSkeleton rows={5} columns={5} />
            </div>
        );
    }

    return (
        <div className="p-6">
            {/* Header */}
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-white">Manajemen Sponsor</h1>
                    <p className="text-gray-400 text-sm mt-1">Kelola sponsor dan paket sponsorship</p>
                </div>
                <button 
                    onClick={() => {
                        resetForm();
                        setShowModal(true);
                    }}
                    className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
                >
                    <span>+</span>
                    <span>Tambah Sponsor</span>
                </button>
            </div>

            {/* Statistics Cards */}
            {stats && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    <div className="bg-dark-800/90 backdrop-blur-md rounded-xl p-4 border border-dark-700/50">
                        <p className="text-gray-400 text-sm">Total Sponsor</p>
                        <p className="text-2xl font-bold text-white mt-1">{stats.total_sponsors}</p>
                    </div>
                    <div className="bg-dark-800/90 backdrop-blur-md rounded-xl p-4 border border-dark-700/50">
                        <p className="text-gray-400 text-sm">Sponsor Aktif</p>
                        <p className="text-2xl font-bold text-green-400 mt-1">{stats.active_sponsors}</p>
                    </div>
                    <div className="bg-dark-800/90 backdrop-blur-md rounded-xl p-4 border border-dark-700/50">
                        <p className="text-gray-400 text-sm">Pendapatan/Bulan</p>
                        <p className="text-2xl font-bold text-primary-400 mt-1">
                            Rp {(stats.monthly_revenue || 0).toLocaleString('id-ID')}
                        </p>
                    </div>
                    <div className="bg-dark-800/90 backdrop-blur-md rounded-xl p-4 border border-dark-700/50">
                        <p className="text-gray-400 text-sm">Akan Berakhir</p>
                        <p className="text-2xl font-bold text-yellow-400 mt-1">
                            {stats.expiring_soon?.length || 0}
                        </p>
                    </div>
                </div>
            )}

            {/* Package Info */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {Object.entries(packages).map(([key, pkg]) => (
                    <div key={key} className="bg-dark-800/90 backdrop-blur-md rounded-xl p-4 border border-dark-700/50">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className={`text-lg font-semibold text-${pkg.color}-400`}>
                                {pkg.name}
                            </h3>
                            <span className="text-white font-bold">
                                Rp {pkg.price.toLocaleString('id-ID')}
                            </span>
                        </div>
                        <ul className="text-sm text-gray-400 space-y-1">
                            {pkg.features.map((feature, i) => (
                                <li key={i} className="flex items-start gap-2">
                                    <span className="text-green-400 mt-0.5">✓</span>
                                    <span>{feature}</span>
                                </li>
                            ))}
                        </ul>
                        <div className="mt-3 pt-3 border-t border-dark-700/50">
                            <p className="text-xs text-gray-500">
                                {key === 'bronze' && `${stats?.bronze_count || 0} sponsor`}
                                {key === 'silver' && `${stats?.silver_count || 0} sponsor`}
                                {key === 'gold' && `${stats?.gold_count || 0} sponsor`}
                            </p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Sponsors List */}
            <div className="bg-dark-800/90 backdrop-blur-md rounded-xl border border-dark-700/50 overflow-hidden">
                <div className="p-4 border-b border-dark-700/50">
                    <h2 className="text-lg font-semibold text-white">Daftar Sponsor</h2>
                </div>
                
                {sponsors.length === 0 ? (
                    <div className="p-8 text-center text-gray-400">
                        <p>Belum ada sponsor</p>
                        <button 
                            onClick={() => setShowModal(true)}
                            className="mt-4 text-primary-400 hover:text-primary-300"
                        >
                            Tambah sponsor pertama
                        </button>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-dark-900/50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Sponsor</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Paket</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Harga</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Periode</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Kontak</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Status</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-dark-700/50">
                                {sponsors.map((sponsor) => (
                                    <tr key={sponsor.id} className="hover:bg-dark-700/30 transition-colors">
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-3">
                                                {sponsor.logo ? (
                                                    <img 
                                                        src={sponsor.logo} 
                                                        alt={sponsor.name}
                                                        className="w-12 h-12 object-contain bg-white rounded"
                                                    />
                                                ) : (
                                                    <div className="w-12 h-12 bg-dark-700 rounded flex items-center justify-center">
                                                        <span className="text-gray-500 text-xs">No Logo</span>
                                                    </div>
                                                )}
                                                <div>
                                                    <p className="text-white font-medium">{sponsor.name}</p>
                                                    {sponsor.url && (
                                                        <a 
                                                            href={sponsor.url} 
                                                            target="_blank" 
                                                            rel="noopener noreferrer"
                                                            className="text-xs text-primary-400 hover:text-primary-300"
                                                        >
                                                            {sponsor.url}
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`
                                                px-3 py-1 rounded-full text-xs font-semibold
                                                ${sponsor.package === 'gold' ? 'bg-yellow-500/20 text-yellow-400' : ''}
                                                ${sponsor.package === 'silver' ? 'bg-gray-400/20 text-gray-300' : ''}
                                                ${sponsor.package === 'bronze' ? 'bg-orange-500/20 text-orange-400' : ''}
                                            `}>
                                                {packages[sponsor.package]?.name || sponsor.package}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-white">
                                            Rp {(sponsor.price || 0).toLocaleString('id-ID')}
                                        </td>
                                        <td className="px-4 py-3 text-gray-400 text-sm">
                                            {sponsor.start_date && (
                                                <div>
                                                    <p>{new Date(sponsor.start_date).toLocaleDateString('id-ID')}</p>
                                                    {sponsor.end_date && (
                                                        <p className="text-xs">s/d {new Date(sponsor.end_date).toLocaleDateString('id-ID')}</p>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-gray-400 text-sm">
                                            {sponsor.contact_name && <p>{sponsor.contact_name}</p>}
                                            {sponsor.contact_email && <p className="text-xs">{sponsor.contact_email}</p>}
                                            {sponsor.contact_phone && <p className="text-xs">{sponsor.contact_phone}</p>}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`
                                                px-2 py-1 rounded text-xs font-medium
                                                ${sponsor.active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}
                                            `}>
                                                {sponsor.active ? 'Aktif' : 'Nonaktif'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => handleEdit(sponsor)}
                                                    className="text-primary-400 hover:text-primary-300 text-sm"
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(sponsor.id, sponsor.name)}
                                                    className="text-red-400 hover:text-red-300 text-sm"
                                                >
                                                    Hapus
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal Form */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-dark-800 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-dark-700/50">
                            <h2 className="text-xl font-bold text-white">
                                {editingId ? 'Edit Sponsor' : 'Tambah Sponsor Baru'}
                            </h2>
                        </div>
                        
                        <form onSubmit={handleSubmit} className="p-6 space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-300 mb-2">
                                        Nama Sponsor *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData({...formData, name: e.target.value})}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500"
                                        required
                                    />
                                </div>

                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-300 mb-2">
                                        URL Logo
                                    </label>
                                    <input
                                        type="url"
                                        value={formData.logo}
                                        onChange={(e) => setFormData({...formData, logo: e.target.value})}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500"
                                        placeholder="https://example.com/logo.png"
                                    />
                                </div>

                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-300 mb-2">
                                        Website URL
                                    </label>
                                    <input
                                        type="url"
                                        value={formData.url}
                                        onChange={(e) => setFormData({...formData, url: e.target.value})}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500"
                                        placeholder="https://example.com"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">
                                        Paket Sponsorship *
                                    </label>
                                    <select
                                        value={formData.package}
                                        onChange={(e) => handlePackageChange(e.target.value)}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500"
                                    >
                                        {Object.entries(packages).map(([key, pkg]) => (
                                            <option key={key} value={key}>
                                                {pkg.name} - Rp {pkg.price.toLocaleString('id-ID')}/bulan
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">
                                        Harga (Rp) *
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.price}
                                        onChange={(e) => setFormData({...formData, price: parseInt(e.target.value)})}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">
                                        Tanggal Mulai
                                    </label>
                                    <input
                                        type="date"
                                        value={formData.start_date}
                                        onChange={(e) => setFormData({...formData, start_date: e.target.value})}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">
                                        Tanggal Berakhir
                                    </label>
                                    <input
                                        type="date"
                                        value={formData.end_date}
                                        onChange={(e) => setFormData({...formData, end_date: e.target.value})}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500"
                                    />
                                </div>

                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-300 mb-2">
                                        Nama Kontak
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.contact_name}
                                        onChange={(e) => setFormData({...formData, contact_name: e.target.value})}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">
                                        Email Kontak
                                    </label>
                                    <input
                                        type="email"
                                        value={formData.contact_email}
                                        onChange={(e) => setFormData({...formData, contact_email: e.target.value})}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">
                                        Telepon Kontak
                                    </label>
                                    <input
                                        type="tel"
                                        value={formData.contact_phone}
                                        onChange={(e) => setFormData({...formData, contact_phone: e.target.value})}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500"
                                    />
                                </div>

                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-300 mb-2">
                                        Catatan
                                    </label>
                                    <textarea
                                        value={formData.notes}
                                        onChange={(e) => setFormData({...formData, notes: e.target.value})}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500"
                                        rows="3"
                                    />
                                </div>

                                <div className="md:col-span-2">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={formData.active}
                                            onChange={(e) => setFormData({...formData, active: e.target.checked})}
                                            className="w-4 h-4 text-primary-600 bg-dark-700 border-dark-600 rounded focus:ring-primary-500"
                                        />
                                        <span className="text-sm text-gray-300">Sponsor Aktif</span>
                                    </label>
                                </div>
                            </div>

                            {/* Package Features Preview */}
                            <div className="bg-dark-900/50 rounded-lg p-4">
                                <p className="text-sm text-gray-400 mb-2">Fitur paket {packages[formData.package].name}:</p>
                                <ul className="text-sm text-gray-300 space-y-1">
                                    {packages[formData.package].features.map((feature, i) => (
                                        <li key={i} className="flex items-start gap-2">
                                            <span className="text-green-400 mt-0.5">✓</span>
                                            <span>{feature}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowModal(false);
                                        resetForm();
                                    }}
                                    className="flex-1 bg-dark-700 hover:bg-dark-600 text-white px-4 py-2 rounded-lg transition-colors"
                                >
                                    Batal
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg transition-colors"
                                >
                                    {editingId ? 'Perbarui' : 'Simpan'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default SponsorManagement;
