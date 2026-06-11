export function CloudBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <Cloud className="top-20 left-[-40px] w-40 opacity-60" />
      <Cloud className="top-40 right-[-30px] w-32 opacity-50" />
      <Cloud className="bottom-32 left-10 w-28 opacity-40" />
      <Rainbow className="top-10 right-10 w-32 opacity-50" />
      <Star className="top-1/3 left-1/4 w-6 opacity-70 text-pink" />
      <Star className="top-1/2 right-1/3 w-5 opacity-60 text-primary" />
    </div>
  );
}

function Cloud({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 120" className={`absolute ${className}`} fill="white" stroke="oklch(0.86 0.07 230)" strokeWidth="2">
      <ellipse cx="60" cy="80" rx="50" ry="32" />
      <ellipse cx="110" cy="65" rx="45" ry="38" />
      <ellipse cx="150" cy="85" rx="40" ry="28" />
    </svg>
  );
}
function Rainbow({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 100" className={`absolute ${className}`} fill="none" strokeWidth="10" strokeLinecap="round">
      <path d="M20 90 A80 80 0 0 1 180 90" stroke="oklch(0.88 0.06 15)" />
      <path d="M35 90 A65 65 0 0 1 165 90" stroke="oklch(0.86 0.1 70)" />
      <path d="M50 90 A50 50 0 0 1 150 90" stroke="oklch(0.88 0.1 140)" />
      <path d="M65 90 A35 35 0 0 1 135 90" stroke="oklch(0.78 0.09 235)" />
    </svg>
  );
}
function Star({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={`absolute ${className}`}>
      <path d="M12 2l2.4 6.9H22l-5.8 4.3 2.2 7-6.4-4.4-6.4 4.4 2.2-7L2 8.9h7.6z" />
    </svg>
  );
}
