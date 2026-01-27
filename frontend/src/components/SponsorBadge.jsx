/**
 * SponsorBadge Component
 * Menampilkan logo sponsor di card kamera
 * 
 * Props:
 * - sponsor: { name, logo, url, package }
 * - size: 'small' | 'medium' | 'large'
 * - position: 'top-right' | 'bottom-right' | 'bottom-left'
 */
function SponsorBadge({ sponsor, size = 'small', position = 'bottom-right' }) {
    if (!sponsor) return null;

    const sizeClasses = {
        small: 'w-16 h-8',
        medium: 'w-24 h-12',
        large: 'w-32 h-16'
    };

    const positionClasses = {
        'top-right': 'top-2 right-2',
        'bottom-right': 'bottom-2 right-2',
        'bottom-left': 'bottom-2 left-2'
    };

    const handleClick = (e) => {
        e.stopPropagation();
        if (sponsor.url) {
            window.open(sponsor.url, '_blank', 'noopener,noreferrer');
        }
    };

    return (
        <div 
            className={`absolute ${positionClasses[position]} z-10 cursor-pointer group`}
            onClick={handleClick}
            title={`Disponsori oleh ${sponsor.name}`}
        >
            <div className={`
                ${sizeClasses[size]} 
                bg-white/90 backdrop-blur-sm 
                rounded-lg shadow-lg 
                flex items-center justify-center 
                p-1.5
                transition-all duration-300
                group-hover:bg-white group-hover:scale-105
                border border-gray-200/50
            `}>
                {sponsor.logo ? (
                    <img 
                        src={sponsor.logo} 
                        alt={sponsor.name}
                        className="w-full h-full object-contain"
                    />
                ) : (
                    <span className="text-xs font-semibold text-gray-700 truncate px-1">
                        {sponsor.name}
                    </span>
                )}
            </div>
            
            {/* Tooltip on hover */}
            <div className="
                absolute bottom-full right-0 mb-2
                hidden group-hover:block
                bg-gray-900 text-white text-xs
                px-3 py-1.5 rounded-lg
                whitespace-nowrap
                shadow-xl
                animate-fade-in
            ">
                Disponsori oleh {sponsor.name}
                <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
            </div>
        </div>
    );
}

export default SponsorBadge;
