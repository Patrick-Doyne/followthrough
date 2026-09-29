/** The fill value referencing a pattern rendered by `HatchPattern`. */
export function hatchFill(id: string): string {
  return `url(#${id})`;
}
