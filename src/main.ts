import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import { embedRefererReady } from "./services/player/embedReferer";

// Register before anything can embed a player; the player also awaits it.
void embedRefererReady();

const app = mount(App, { target: document.getElementById("app")! });

export default app;
