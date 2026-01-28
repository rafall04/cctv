/**
 * Saweria Footer Link Component
 * 
 * Simple link to be placed in footer
 * Always visible as fallback option
 */

export default function SaweriaFooterLink({ link = 'https://saweria.co/raflialdi' }) {
    const handleClick = (e) => {
        e.preventDefault();
        window.open(link, '_blank', 'noopener,noreferrer');
    };

    return (
        <a
            href={link}
            onClick={handleClick}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-semibold rounded-lg transition-all duration-300 transform hover:scale-105 shadow-md hover:shadow-lg text-sm"
            target="_blank"
            rel="noopener noreferrer"
        >
            <span className="text-lg">☕</span>
            <span>Dukung Kami</span>
        </a>
    );
}
