/**
 * Vocion brand mark + wordmark.
 *
 * The mark is three rising bars — growth, signal, momentum. Solid fill in
 * `currentColor` so it inherits the surrounding text color (works in
 * light/dark themes and anywhere the wordmark sits).
 * @param props
 * @param props.isTextHidden
 * @param props.size
 */
export const VocionLogo = (props: { isTextHidden?: boolean; size?: 'sm' | 'md' | 'lg' }) => {
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
        {/* Three rising bars — growth, signal, momentum. */}
        <rect x="3" y="14" width="4" height="7" rx="1" />
        <rect x="10" y="9" width="4" height="12" rx="1" />
        <rect x="17" y="4" width="4" height="17" rx="1" />
      </svg>
      {!props.isTextHidden && (
        <span>Vocion</span>
      )}
    </div>
  );
};
