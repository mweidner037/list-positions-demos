import { Loader } from "./Loader";
import { DocPicker } from "./recipe-components/DocPicker";

export default function App() {
  return (
    <Loader>
      <DocPicker />
    </Loader>
  );
}
