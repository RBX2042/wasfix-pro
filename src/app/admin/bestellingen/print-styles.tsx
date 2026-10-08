/**
 * Print rules for the packing slip and the pick list. The root layout adds a cookie banner and a
 * mobile bottom bar that sit on top of every page; on paper they must not appear, and the paper
 * must be white. Selectors use the roles/labels of those components, which this bundle does not own.
 */
export function PrintStyles() {
  return (
    <style>{`@media print {
      [role="dialog"][aria-labelledby="consent-title"], nav[aria-label="Mobiele navigatie"], nextjs-portal { display: none !important; }
      html, body, article { background: #fff !important; }
    }`}</style>
  );
}
