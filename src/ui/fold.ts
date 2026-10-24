export function fold(s: string): string {
  return s.toLowerCase().replace(/[‘’‚‛′`´]/g, "'").replace(/[“”„‟″]/g, '"');
}
