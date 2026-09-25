/**
 * Itemy hráče po slotech inventáře.
 *
 * `items` drží jen seznam itemID bez prázdných míst — z něj nejde poznat,
 * který item leží v kterém slotu. Web ale ukazuje pevná pole: šest itemů,
 * trinket a odměnu za role quest. Proto se posílá i tohle pole o devíti
 * místech, kde 0 znamená prázdný slot:
 *
 *   0–5  běžné itemy
 *   6    trinket
 *   7    Recall (klient ho hlásí jako item)
 *   8    odměna za role quest (top teleport, boty ADC, …)
 *
 * Rozložení je ověřené na záznamu hry z LeagueBroadcastu 25. 9. 2026.
 */
export const ITEM_SLOT_COUNT = 9;

export function toItemSlots(items: Array<{ id: number; slot: number; count?: number }>): number[] {
  const slots = new Array<number>(ITEM_SLOT_COUNT).fill(0);
  for (const item of items) {
    if (!(item.id > 0) || item.count === 0) continue;
    if (!Number.isInteger(item.slot) || item.slot < 0 || item.slot >= ITEM_SLOT_COUNT) continue;
    slots[item.slot] = item.id;
  }
  return slots;
}
