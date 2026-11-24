import { ListPage } from '@/system';
import { SuggestionsView, SuggestionsLoading } from '@/views/suggestions.tsx';

export default function ForReview() {
  return (
    <ListPage title="For review">
      <SuggestionsView loading={<SuggestionsLoading />} />
    </ListPage>
  );
}
