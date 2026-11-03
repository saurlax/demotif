import { runAudioTask } from './audioTasks'
import type { AudioTask, AudioTaskReply } from './audioTasks'

const scope = self as unknown as {
  onmessage: (event: MessageEvent<{ id: number; task: AudioTask }>) => void
  postMessage: (message: AudioTaskReply, transfer?: Transferable[]) => void
}
scope.onmessage = ({ data: { id, task } }) => {
  try {
    const result = runAudioTask(task)
    const data = 'pcm' in result ? result.pcm : result.wav
    scope.postMessage({ id, result }, [
      data.buffer,
      ...('pcm' in result && result.right ? [result.right.buffer] : []),
    ])
  } catch (error) {
    scope.postMessage({
      id,
      error: error instanceof Error ? error.message : '音频计算失败',
    })
  }
}
