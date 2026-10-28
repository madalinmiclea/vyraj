import { lang } from '../i18n';

const LORE_RO: Record<string, string> = {
  'Weaving the Flow…': 'Se țese Curgerea…',
  'Every path of the Flow, woven into one': 'Toate cărările Curgerii, țesute într-una singură',
  'Choose What the Conduit Weighs': 'Alege ce va cântări Conduitul',
  'Pick an item from the item browser or search above. Prices flow live from the Jita 4-4 orders.': 'Alege-ți lucrul din vistieria de iteme ori caută-l mai sus. Prețurile curg nestăvilite din tocmelile Jitei 4-4.',
  'The Conduit Is Silent': 'Conduitul tace',
  'This item exists, but no order flows for it in Jita right now (common for officer modules and rare items). Return later; prices refresh with every search.': 'Lucrul acesta ființează, dar nicio tocmeală nu curge pentru el în Jita într-acest ceas (precum se întâmplă la modulele de ofițer și la cele rare). Întoarce-te mai apoi; prețurile se înnoiesc la fiecare căutare.',
  'Choose the Form to Master': 'Alege chipul ce se cuvine stăpânit',
  'Search above for an item. The Flow shall reveal which skills must be woven and how long the weaving takes.': 'Caută mai sus un item. Curgerea îți va descoperi ce skill-uri se cuvin țesute și cât va ține țesutul.',
  'Nothing to Discern': 'Nimic de deslușit',
  'Paste the pilot names from Local (one per line) or the lines copied from D-Scan, and the Clade shall discern them.': 'Așază aici numele piloților din Local (câte unul pe rând) ori rândurile luate din D-Scan, iar Clada îi va desluși.',
  'Jita Not Yet Discerned': 'Jita încă nedeslușită',
  'The scan reads The Forge orders and 30 days of history for the most active items.': 'Iscodirea citește tocmelile din The Forge și cronica celor 30 de zile pentru itemele cele mai umblate.',
  'No Raiment Answers': 'Niciun veșmânt nu răspunde',
  'No SKIN answers the current filter.': 'Niciun SKIN nu răspunde chemării de acum.',
  'All Raiment Gathered': 'Toate veșmintele sunt adunate',
  'Every SKIN in the current filter is already yours.': 'Tot SKIN-ul din chemarea de acum îți aparține deja.',
  'Choose the Hull to Prove': 'Alege trupul ce va fi pus la Proving',
  'Open “Ships” in the item browser and select a hull. Then bind modules, charges or drones to it. A fit from the game or from Pyfa may also be woven in through EFT import.': 'Deschide „Nave” în vistieria de iteme și alege un trup. Apoi leagă de el module, muniție ori drone. Un fit adus din joc ori din Pyfa poate fi țesut și prin import EFT.',
  'No Capsuleer Bound': 'Niciun capsuler legat',
  'Bind a capsuleer through EVE login on the Character screen to see your market orders.': 'Leagă un capsuler prin legământul EVE din ecranul Caracter, ca să-ți fie arătate tocmelile din piață.',
  'No Provings Kept': 'Niciun Proving păstrat',
  'Press “Save” on a fit and it shall be kept here.': 'Apasă „Salvează” pe un fit și acesta va fi păstrat aici.',
  'No Hulls Assembled': 'Niciun trup închegat',
  'No assembled vessels were found among your holdings.': 'Nicio navă închegată nu s-a aflat printre averile tale.',
  'Tended Worlds': 'Lumile oblăduite',
  'Clade Census': 'Catastiful Cladei',
  'Discourse': 'Sfatul',
  'Cladistic Recon': 'Iscoada cladistică',
  'Krai Passage': 'Trecătoarea Krai',
  'Matterweave': 'Țesătura materiei',
  'Tithe': 'Zeciuiala',
  'Raiment': 'Veșmintele',
  'Rootweave': 'Țesătura rădăcinilor',
  'Proving failed': 'Proving-ul n-a izbândit',
  'The Hunt Finds No Trail': 'Vânătoarea nu află urmă',
  'No quarry answers these words. Loosen the snare and listen again.': 'Niciun vânat nu răspunde la vorbele acestea. Slăbește lațul și ascultă iarăși.',
};

export function loreText(s: string) {
  if (lang !== 'ro') return s;
  const clade = /^(\S+) Clade$/.exec(s);
  if (clade) return `Clada ${clade[1]}`;
  return LORE_RO[s] ?? s;
}
