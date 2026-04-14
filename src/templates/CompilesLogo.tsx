/**
 * Compiles.ai brand mark + wordmark — used in marketing pages.
 *
 * The mark is a cairn: four stones stacked, slightly off-axis. Solid fill
 * in `currentColor` so it picks up the surrounding text color (works in
 * both light and dark themes, in nav header, in inverted footer, etc).
 *
 * The dashboard / app continues to use the CoreContext `<Logo />` from
 * `Logo.tsx`. This component is the public-brand surface only.
 * @param props
 * @param props.isTextHidden
 * @param props.size
 */
export const CompilesLogo = (props: { isTextHidden?: boolean; size?: 'sm' | 'md' | 'lg' }) => {
  const sizeClass
    = props.size === 'sm'
      ? 'size-6 text-base'
      : props.size === 'lg'
        ? 'size-10 text-2xl'
        : 'size-8 text-xl';

  return (
    <div className={`flex items-center font-semibold tracking-tight ${sizeClass}`}>
      <svg
        className="mr-2 shrink-0"
        width="100%"
        height="100%"
        viewBox="0 0 24 24"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* base stone — widest, lowest */}
        <ellipse cx="12" cy="20" rx="9" ry="2.4" />
        {/* second stone — slight rightward offset */}
        <ellipse cx="12.6" cy="15" rx="7" ry="2.2" />
        {/* third stone — slight leftward offset */}
        <ellipse cx="11.4" cy="10.2" rx="4.8" ry="2" />
        {/* crown stone — small, centered */}
        <ellipse cx="12" cy="5.8" rx="2.6" ry="1.6" />
      </svg>
      {!props.isTextHidden && (
        <span>
          Compiles
          <span className="text-foreground/55">.ai</span>
        </span>
      )}
    </div>
  );
};
