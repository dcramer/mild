import { Clause, Document, TextLink } from '@/system';

// Each copy of sift is run by whoever set it up, on their own machine, with their own Google client, so
// "we" is that person and there is no company behind it. Google's verification reads these pages: the
// Limited Use statement must stay word for word, and what they say sift keeps must stay true of the code.
const UPDATED = 'November 15, 2026';
const USER_DATA_POLICY = 'https://developers.google.com/terms/api-services-user-data-policy';
const PERMISSIONS = 'https://myaccount.google.com/permissions';

export function PrivacyView() {
  return (
    <main>
      <Document title="Privacy policy" updated={UPDATED}>
        <p>
          Sift helps manage a Gmail inbox: it classifies mail, and, as you tell it to, archives it, marks it as spam or unsubscribes from it. Each copy of Sift
          is run by the person or organisation that set it up (“we”), on a machine of their own. There is no Sift company, and nothing you give this copy is
          sent to the people who write Sift.
        </p>

        <Clause title="What Sift reads">
          <ul>
            <li>Your Google account’s email address, when you sign in.</li>
            <li>
              Your Gmail, through two permissions. <strong>gmail.modify</strong> lets it read messages and their labels, label them, archive them and mark them
              as spam. <strong>gmail.settings.basic</strong> lets it add and remove Gmail filters for the rules you ask it to copy into Gmail. Sift does not ask
              to send mail, and it never deletes or trashes it.
            </li>
            <li>
              For each message in your inbox: its headers (sender, recipients, subject, date, the sender’s authentication results, mailing list and unsubscribe
              headers) and its Gmail labels.
            </li>
            <li>Its body, only when a model is about to judge it, while it waits for your answer, and once you have answered for it.</li>
            <li>
              Whether you have written to a sender, and for a reply, whether you wrote earlier in the thread. No other message’s content is read for this.
            </li>
          </ul>
        </Clause>

        <Clause title="What Sift keeps">
          <ul>
            <li>A record of every message it reads: the facts from its headers and its subject, not its body.</li>
            <li>Every decision it made and every change it made to your mailbox, so you can see why and undo it.</li>
            <li>Your labels, rules and answers.</li>
            <li>The text of mail waiting for your answer. It is deleted when you answer, when the message stops waiting, and after 30 days in any case.</li>
            <li>
              The text of each message you answered for, kept as an example that teaches Sift your preferences, until you delete it in the dashboard or the
              period we set for examples ends.
            </li>
            <li>Google’s access token for your account, stored apart from your mail, readable only by Sift, and encrypted when we have set a key.</li>
          </ul>
          <p>
            Each person’s mail is kept in a database of its own, and the dashboard shows you only your own mailboxes. We may set Sift to forget messages nothing
            has happened to after a number of days; otherwise everything is kept until it is deleted.
          </p>
        </Clause>

        <Clause title="How it is used">
          <p>
            Only to classify your mail the way you set it up, and to show you what Sift did and what it would do. It is not used for advertising, not sold, and
            not used to train AI models beyond teaching your own copy of Sift, through your examples, what your mail is.
          </p>
          <p>
            No person reads your mail through Sift but you, unless you ask us to (to look into a problem, say), it is needed to keep Sift secure, or the law
            requires it.
          </p>
        </Clause>

        <Clause title="Who else receives it">
          <ul>
            <li>
              <strong>An AI model provider.</strong> When none of your rules decides a message, Sift asks a language model which of your labels it is. The model
              is sent the message’s sender, subject, the facts from its headers, the start of its text, your guidance and a few of your past examples, and
              answers with a label. The provider is the one we chose for this copy of Sift (OpenAI or Anthropic), under terms that do not let it train its
              models on what Sift sends. The model can only answer: it cannot act on your mailbox.
            </li>
            <li>
              <strong>Senders you unsubscribe from.</strong> Only where your label or rule says to, Sift sends the sender’s own one-click unsubscribe request,
              which tells them that your address unsubscribed.
            </li>
            <li>
              <strong>Google</strong>, which holds your mail and carries out the changes Sift makes to it.
            </li>
          </ul>
          <p>No one else, unless the law requires it.</p>
        </Clause>

        <Clause title="Google user data">
          <p>
            Sift’s use and transfer of information received from Google APIs to any other app will adhere to the{' '}
            <TextLink href={USER_DATA_POLICY}>Google API Services User Data Policy</TextLink>, including the Limited Use requirements.
          </p>
        </Clause>

        <Clause title="Stopping and deleting">
          <ul>
            <li>Delete examples in the dashboard, one at a time or all of a mailbox’s.</li>
            <li>
              Remove Sift’s access at any time in your <TextLink href={PERMISSIONS}>Google account’s permissions</TextLink>. Sift then cannot read or change
              your mail.
            </li>
            <li>
              Remove a mailbox, or delete your account, under Settings. Sift revokes its access at Google and deletes everything it holds about that mail. The
              Gmail filters it wrote stay in Gmail until you delete them there.
            </li>
          </ul>
        </Clause>

        <Clause title="Children">
          <p>Sift is not for anyone under 13.</p>
        </Clause>

        <Clause title="Changes and contact">
          <p>
            When this policy changes, the date above changes with it. Questions and requests go to the support address Google shows when you sign in to Sift.
            See also the <TextLink href="/terms">terms of service</TextLink>.
          </p>
        </Clause>
      </Document>
    </main>
  );
}

export function TermsView() {
  return (
    <main>
      <Document title="Terms of service" updated={UPDATED}>
        <p>
          These terms are between you and the person or organisation running this copy of Sift (“we”). By signing in, you agree to them and to the{' '}
          <TextLink href="/privacy">privacy policy</TextLink>.
        </p>

        <Clause title="What Sift does">
          <p>
            Sift decides what each message in your Gmail inbox is, from rules you write, from what it has learned from your answers and, when those do not
            decide, from a language model. What happens to a label’s mail is yours to choose. Until you turn Sift on, it only suggests: nothing in Gmail changes
            but the messages you answer for in the dashboard.
          </p>
          <p>
            When it acts, it only labels, archives, marks as read or as spam, and unsubscribes, and only mail still in your inbox. It never sends, replies,
            forwards or deletes. Each change is recorded, and you can undo it from the dashboard.
          </p>
        </Clause>

        <Clause title="Your part">
          <ul>
            <li>Sign in only with a Gmail account that is yours, or that you are allowed to manage.</li>
            <li>Check what Sift suggests before turning it on. A model can be wrong, and a rule does what it says even when that is not what you meant.</li>
            <li>Don’t use Sift to break the law, to reach anyone else’s mail, or to interfere with this copy of Sift or the machine it runs on.</li>
          </ul>
        </Clause>

        <Clause title="Other services">
          <p>
            Sift works through Google’s services and an AI model provider, and their own terms apply to them. We are not responsible for what they do, or for
            the websites of senders you unsubscribe from.
          </p>
        </Clause>

        <Clause title="No warranty">
          <p>
            Sift is provided as it is, without warranties of any kind. We do not promise it will classify every message correctly, be available all the time, or
            keep every record.
          </p>
        </Clause>

        <Clause title="Liability">
          <p>
            As far as the law allows, we are not liable for indirect or consequential loss arising from your use of Sift, including mail that was missed,
            mislabelled, archived or marked as spam.
          </p>
        </Clause>

        <Clause title="Ending">
          <p>
            You can stop at any time by deleting your account under Settings, which deletes your data, or by removing Sift’s access in your{' '}
            <TextLink href={PERMISSIONS}>Google account</TextLink>. We may end your access to this copy of Sift at any time.
          </p>
        </Clause>

        <Clause title="Changes">
          <p>When these terms change, the date above changes with them. Using Sift after that means you accept the new terms.</p>
        </Clause>
      </Document>
    </main>
  );
}
