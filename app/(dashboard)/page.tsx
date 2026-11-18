import { SenderCellLoading } from '@/components/sender.tsx';
import { Blank, ListPage, Loading, OnPhone, RowActions, Sub, Td } from '@/system';
import { SuggestionsView } from '@/views/suggestions.tsx';

export default function ForReview() {
  return (
    <ListPage title="For review">
      <SuggestionsView
        loading={
          <Loading>
            <SenderCellLoading>
              <OnPhone>
                <span className="w-full text-base">
                  <Blank />
                </span>
                <Blank />
              </OnPhone>
            </SenderCellLoading>
            <Td phone="hide" className="max-w-0 md:w-full">
              <Blank />
              <Sub>
                <Blank />
              </Sub>
            </Td>
            <Td phone="hide" num>
              <Blank word />
            </Td>
            <RowActions>
              <Blank className="h-(--control) w-60 py-0" />
            </RowActions>
          </Loading>
        }
      />
    </ListPage>
  );
}
