import { TriplitClient } from "@triplit/client";
import { schema } from "../triplit/schema";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
      <button id="counter" type="button">Increment</button>
  </div>
`;

const client = new TriplitClient({
  schema,
  serverUrl: import.meta.env.VITE_TRIPLIT_SERVER_URL,
  token: import.meta.env.VITE_TRIPLIT_TOKEN,
});

const counter = document.querySelector<HTMLButtonElement>("#counter")!;
counter.onclick = async () => {
  await client.insert("counter", { op: "+1" });
};

const counterQuery = client.query("counter").build();
client.subscribe(counterQuery, (data) => {
  console.log(data.size);
});
