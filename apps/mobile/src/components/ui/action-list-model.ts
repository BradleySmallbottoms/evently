/** Gold and red from the swipe-list reference. Edit sits beside delete. */
export const swipeEditColor = '#C4A35A';
export const swipeDeleteColor = '#E24B3C';

export type ActionListItem = {
  id: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  /** Present only when this row can be edited. */
  onEdit?: () => void;
  onDelete?: () => void;
};
