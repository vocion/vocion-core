/**
 * Compiles.ai brand mark + wordmark — used in marketing pages and dashboard.
 *
 * The mark is a cairn: four stones stacked, slightly off-axis. Solid fill
 * in `currentColor` so it picks up the surrounding text color (works in
 * both light and dark themes, in nav header, in inverted footer, etc).
 * @param props
 * @param props.isTextHidden
 * @param props.size
 */
export const CompilesLogo = (props: { isTextHidden?: boolean; size?: 'sm' | 'md' | 'lg' }) => {
  const iconSize
    = props.size === 'sm'
      ? 'size-5'
      : props.size === 'lg'
        ? 'size-9'
        : 'size-7';
  const textSize
    = props.size === 'sm'
      ? 'text-base'
      : props.size === 'lg'
        ? 'text-2xl'
        : 'text-lg';

  return (
    <div className={`inline-flex items-center font-semibold tracking-tight ${textSize}`}>
      <svg
        className={`mr-2 shrink-0 ${iconSize}`}
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
