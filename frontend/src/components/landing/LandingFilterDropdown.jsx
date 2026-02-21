import { useEffect, useState, useRef } from 'react';
import { useCameras } from '../../contexts/CameraContext';
import { Icons } from '../ui/Icons';

export default function FilterDropdown({ selected, onChange, kecamatans = [], kelurahans = [] }) {
    const { cameras, areas } = useCameras();
    const [open, setOpen] = useState(false);
    const [filterType, setFilterType] = useState('area');
    const ref = useRef(null);

    useEffect(() => {
        const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const getCameraCount = (type, value) => {
        if (!value) return cameras.length;
        if (type === 'area') return cameras.filter(c => c.area_id === value).length;
        if (type === 'kecamatan') return cameras.filter(c => c.kecamatan === value).length;
        if (type === 'kelurahan') return cameras.filter(c => c.kelurahan === value).length;
        return 0;
    };

    const getSelectedLabel = () => {
        if (!selected) return 'All Cameras';
        if (selected.type === 'area') {
            const area = areas.find(a => a.id === selected.value);
            return area?.name || 'Unknown';
        }
        return selected.value;
    };

    const handleSelect = (type, value) => {
        onChange(value ? { type, value } : null);
        setOpen(false);
    };

    const showAreaTab = areas.length > 0;
    const showKecamatanTab = kecamatans.length > 0;
    const showKelurahanTab = kelurahans.length > 0;

    useEffect(() => {
        if (filterType === 'area' && !showAreaTab) {
            if (showKecamatanTab) setFilterType('kecamatan');
            else if (showKelurahanTab) setFilterType('kelurahan');
        }
    }, [filterType, showAreaTab, showKecamatanTab, showKelurahanTab]);

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-primary transition-colors shadow-sm"
            >
                <Icons.Filter />
                <span className="text-sm font-medium max-w-[150px] truncate">{getSelectedLabel()}</span>
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-sky-100 dark:bg-primary/20 text-primary-600 dark:text-primary-400 font-semibold">
                    {selected ? getCameraCount(selected.type, selected.value) : cameras.length}
                </span>
                <Icons.ChevronDown />
            </button>
            {open && (
                <div className="absolute top-full left-0 sm:left-auto sm:right-0 mt-2 w-72 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 py-2 z-50 max-h-96 overflow-hidden flex flex-col">
                    <div className="px-2 pb-2 border-b border-gray-100 dark:border-gray-700 flex gap-1">
                        {showAreaTab && (
                            <button
                                onClick={() => setFilterType('area')}
                                className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-lg transition-colors ${filterType === 'area'
                                    ? 'bg-sky-100 dark:bg-primary/20 text-primary-600 dark:text-primary-400'
                                    : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                                    }`}
                            >
                                Area ({areas.length})
                            </button>
                        )}
                        {showKecamatanTab && (
                            <button
                                onClick={() => setFilterType('kecamatan')}
                                className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-lg transition-colors ${filterType === 'kecamatan'
                                    ? 'bg-sky-100 dark:bg-primary/20 text-primary-600 dark:text-primary-400'
                                    : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                                    }`}
                            >
                                Kecamatan ({kecamatans.length})
                            </button>
                        )}
                        {showKelurahanTab && (
                            <button
                                onClick={() => setFilterType('kelurahan')}
                                className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-lg transition-colors ${filterType === 'kelurahan'
                                    ? 'bg-sky-100 dark:bg-primary/20 text-primary-600 dark:text-primary-400'
                                    : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                                    }`}
                            >
                                Kelurahan ({kelurahans.length})
                            </button>
                        )}
                    </div>

                    <div className="overflow-y-auto flex-1">
                        <button
                            onClick={() => handleSelect(null, null)}
                            className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center justify-between transition-colors ${!selected ? 'bg-sky-50 dark:bg-primary/10 text-primary-600 dark:text-primary-400 font-medium' : 'text-gray-700 dark:text-gray-200'}`}
                        >
                            <span className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                                All Cameras
                            </span>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                                {cameras.length}
                            </span>
                        </button>

                        {filterType === 'area' && areas.map((area, idx) => {
                            const count = getCameraCount('area', area.id);
                            const isSelected = selected?.type === 'area' && selected?.value === area.id;
                            return (
                                <button
                                    key={area.id ?? `area-${idx}`}
                                    onClick={() => handleSelect('area', area.id)}
                                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center justify-between transition-colors ${isSelected ? 'bg-sky-50 dark:bg-primary/10 text-primary-600 dark:text-primary-400 font-medium' : 'text-gray-700 dark:text-gray-200'}`}
                                >
                                    <div className="flex-1 min-w-0">
                                        <span className="flex items-center gap-2">
                                            <span className={`w-2 h-2 rounded-full ${isSelected ? 'bg-primary' : 'bg-purple-500'}`}></span>
                                            <span className="truncate">{area.name}</span>
                                        </span>
                                        {(area.kelurahan || area.kecamatan) && (
                                            <span className="text-[10px] text-gray-400 ml-4 block truncate">
                                                {[area.rt && `RT ${area.rt}`, area.rw && `RW ${area.rw}`, area.kelurahan, area.kecamatan].filter(Boolean).join(', ')}
                                            </span>
                                        )}
                                    </div>
                                    <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ml-2 ${count > 0 ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300' : 'bg-gray-50 dark:bg-gray-800 text-gray-400'}`}>
                                        {count}
                                    </span>
                                </button>
                            );
                        })}

                        {filterType === 'kecamatan' && kecamatans.map((kec, idx) => {
                            const count = getCameraCount('kecamatan', kec);
                            const isSelected = selected?.type === 'kecamatan' && selected?.value === kec;
                            return (
                                <button
                                    key={kec ?? `kec-${idx}`}
                                    onClick={() => handleSelect('kecamatan', kec)}
                                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center justify-between transition-colors ${isSelected ? 'bg-sky-50 dark:bg-primary/10 text-primary-600 dark:text-primary-400 font-medium' : 'text-gray-700 dark:text-gray-200'}`}
                                >
                                    <span className="flex items-center gap-2">
                                        <span className={`w-2 h-2 rounded-full ${isSelected ? 'bg-primary' : 'bg-primary'}`}></span>
                                        <span className="truncate">{kec}</span>
                                    </span>
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${count > 0 ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300' : 'bg-gray-50 dark:bg-gray-800 text-gray-400'}`}>
                                        {count}
                                    </span>
                                </button>
                            );
                        })}

                        {filterType === 'kelurahan' && kelurahans.map((kel, idx) => {
                            const count = getCameraCount('kelurahan', kel);
                            const isSelected = selected?.type === 'kelurahan' && selected?.value === kel;
                            const kec = cameras.find(c => c.kelurahan === kel)?.kecamatan || areas.find(a => a.kelurahan === kel)?.kecamatan;
                            return (
                                <button
                                    key={kel ?? `kel-${idx}`}
                                    onClick={() => handleSelect('kelurahan', kel)}
                                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center justify-between transition-colors ${isSelected ? 'bg-sky-50 dark:bg-primary/10 text-primary-600 dark:text-primary-400 font-medium' : 'text-gray-700 dark:text-gray-200'}`}
                                >
                                    <div className="flex-1 min-w-0">
                                        <span className="flex items-center gap-2">
                                            <span className={`w-2 h-2 rounded-full ${isSelected ? 'bg-primary' : 'bg-green-500'}`}></span>
                                            <span className="truncate">{kel}</span>
                                        </span>
                                        {kec && <span className="text-[10px] text-gray-400 ml-4 block">{kec}</span>}
                                    </div>
                                    <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ml-2 ${count > 0 ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300' : 'bg-gray-50 dark:bg-gray-800 text-gray-400'}`}>
                                        {count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
