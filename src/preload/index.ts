import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type ReviewDecision, type ReviewPayload } from '../shared/types';
import type { FormaliseBridge } from './index.d';

const bridge: FormaliseBridge = {
  onReviewShow(callback) {
    const listener = (_event: Electron.IpcRendererEvent, payload: ReviewPayload): void => {
      callback(payload);
    };
    ipcRenderer.on(IPC.reviewShow, listener);
    return () => {
      ipcRenderer.removeListener(IPC.reviewShow, listener);
    };
  },
  decide(decision: ReviewDecision) {
    ipcRenderer.send(IPC.reviewDecision, decision);
  },
};

contextBridge.exposeInMainWorld('formalise', bridge);
