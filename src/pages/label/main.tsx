import { render } from "preact";
import { SITE_HEADERS_KEY } from "../../messages";
import { MoxfieldClient, type SiteHeaders } from "../../moxfield/client";
import { browserStore } from "../../util/store";
import { LabelApp } from "./App";
import "../pick/styles.css";
import "./styles.css";

const store = browserStore(browser.storage.local);
const client = new MoxfieldClient(
  (input, init) => fetch(input, init),
  async () => (await store.get<SiteHeaders>(SITE_HEADERS_KEY)) ?? {},
);

render(<LabelApp client={client} store={store} />, document.getElementById("app")!);
