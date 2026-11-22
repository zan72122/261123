// ごしごし！うわばきあらってほそう — entry point.
import { start } from './game.js';
import { washStages } from './scenes_wash.js';
import { dryStages } from './scenes_dry.js';

start([...washStages, ...dryStages]);
