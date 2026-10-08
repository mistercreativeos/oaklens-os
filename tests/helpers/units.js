// THE SCALE (K74): the console's stylesheet writes every viewport and
// container unit through a token that takes a large screen's zoom back out
// (`2dvh` is `calc(2 * var(--u-dvh))`). A test that reads a length reads it
// back in the plain unit, so it still says what it meant.
export const plainUnits = (css) => css.replace(/calc\(([\d.]+) \* var\(--u-([a-z]+)\)\)/g, '$1$2');
