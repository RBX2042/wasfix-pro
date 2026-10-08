/**
 * Keeps wide content (tables) from widening the whole page on a phone. DashboardLayout puts the
 * page in a grid item whose minimum width is its content's, so one 900 px table made the page 978 px
 * wide at 375 px even though the table sat in an overflow-x-auto box. `contain: inline-size` gives this
 * box no intrinsic width of its own: it takes the width of the column and the table scrolls inside.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  return <div className="w-full min-w-0 [contain:inline-size]">{children}</div>;
}
