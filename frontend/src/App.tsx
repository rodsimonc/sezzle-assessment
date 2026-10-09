import { HttpCalculatorApi, type CalculatorApi } from './api/client';
import { useCalculator } from './calculator/useCalculator';
import { useKeyboard } from './calculator/useKeyboard';
import { Display } from './components/Display';
import { ErrorBanner } from './components/ErrorBanner';
import { HistoryPanel } from './components/HistoryPanel';
import { Keypad } from './components/Keypad';
import { useHistory } from './history/useHistory';

const httpApi = new HttpCalculatorApi();

interface AppProps {
  /** Tests pass a fake. The app talks to the backend over HTTP by default. */
  api?: CalculatorApi;
}

export function App({ api = httpApi }: AppProps) {
  const history = useHistory();
  const calculator = useCalculator(api, history.add);
  const { press } = calculator;
  useKeyboard(press);

  return (
    <main className="app">
      <h1 className="app__title">Calculator</h1>
      <div className="app__layout">
        <div className="calculator">
          <div className="readout">
            <Display
              value={calculator.display}
              expression={calculator.expression}
              memoryActive={calculator.memoryActive}
            />
            <ErrorBanner message={calculator.error} />
          </div>
          <Keypad busy={calculator.busy} onPress={press} />
        </div>
        <HistoryPanel
          entries={history.entries}
          onSelect={(entry) => {
            press({ type: 'pick', value: entry.result });
          }}
          onClear={history.clear}
        />
      </div>
    </main>
  );
}
