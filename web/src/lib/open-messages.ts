import { createContext, useContext } from 'react';
import type { MessageRef } from '@/views/message-panel.tsx';

/** Opens the message panel on `items[index]`, stepping through `items`. */
export type OpenMessages = (items: MessageRef[], index: number) => void;

/** Given by the dashboard's frame, which holds the panel, to every screen in it. */
export const OpenMessagesContext = createContext<OpenMessages>(() => {});

export const useOpenMessages = () => useContext(OpenMessagesContext);
