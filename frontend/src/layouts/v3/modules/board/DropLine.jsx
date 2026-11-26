// The line that shows where a dragged card will land: 3px, between two cards or after the last
// one. Decoration only (hidden from assistive technology; the announcements carry the position).
export default function DropLine() {
  return <li aria-hidden="true" className="v3-board-dropline" />
}
