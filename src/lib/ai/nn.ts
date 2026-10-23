// Small multilayer perceptron with manual backprop and Adam. Pure functions, no dependencies.
// Layer l maps sizes[l] -> sizes[l+1]; weights[l] is row-major (out * in). ReLU hidden layers, linear output.
export type Mlp={
  sizes: number[];
  weights: Float32Array[];
  biases: Float32Array[];
};

export type Adam={
  mW: Float32Array[];
  vW: Float32Array[];
  mB: Float32Array[];
  vB: Float32Array[];
  t: number;
};

export type Gradients={
  loss: number;
  gradW: Float32Array[];
  gradB: Float32Array[];
};

const HUBER_DELTA=1;
const BETA1=0.9;
const BETA2=0.999;
const EPSILON=1e-8;

function gaussian(rng: () => number): number {
  // Box-Muller; 1 - rng() keeps the log argument in (0, 1]
  return Math.sqrt(-2*Math.log(1-rng()))*Math.cos(2*Math.PI*rng());
}

export function createMlp(sizes: number[], rng: () => number=Math.random): Mlp {
  const weights: Float32Array[]=[];
  const biases: Float32Array[]=[];
  for (let l=0; l<sizes.length-1; l++) {
    const w=new Float32Array(sizes[l]*sizes[l+1]);
    const std=Math.sqrt(2/sizes[l]);   // He init
    for (let i=0; i<w.length; i++) w[i]=gaussian(rng)*std;
    weights.push(w);
    biases.push(new Float32Array(sizes[l+1]));
  }
  return { sizes: sizes.slice(), weights, biases };
}

// Activations of every layer (index 0 is the input). Float64 keeps the gradient check and training accurate.
function activations(net: Mlp, input: ArrayLike<number>): Float64Array[] {
  const layers: Float64Array[]=[Float64Array.from(input)];
  const last=net.weights.length-1;
  for (let l=0; l<=last; l++) {
    const inSize=net.sizes[l];
    const outSize=net.sizes[l+1];
    const w=net.weights[l];
    const prev=layers[l];
    const out=new Float64Array(outSize);
    for (let o=0; o<outSize; o++) {
      let sum=net.biases[l][o];
      const row=o*inSize;
      for (let i=0; i<inSize; i++) sum+=w[row+i]*prev[i];
      out[o]=l<last&&sum<0 ? 0 : sum;
    }
    layers.push(out);
  }
  return layers;
}

export function forward(net: Mlp, input: ArrayLike<number>): Float32Array {
  const layers=activations(net, input);
  return Float32Array.from(layers[layers.length-1]);
}

function zerosLike(arrays: Float32Array[]): Float32Array[] {
  return arrays.map((a) => new Float32Array(a.length));
}

export function createAdam(net: Mlp): Adam {
  return { mW: zerosLike(net.weights), vW: zerosLike(net.weights), mB: zerosLike(net.biases), vB: zerosLike(net.biases), t: 0 };
}

// Mean Huber loss over the batch. Outputs with mask 0 contribute no loss and no gradient.
export function lossAndGradients(
  net: Mlp,
  inputs: ArrayLike<number>[],
  targets: ArrayLike<number>[],
  masks: ArrayLike<number>[],
): Gradients {
  const gradW=zerosLike(net.weights);
  const gradB=zerosLike(net.biases);
  const layerCount=net.weights.length;
  const batch=inputs.length;
  let loss=0;

  for (let n=0; n<batch; n++) {
    const layers=activations(net, inputs[n]);
    const output=layers[layerCount];
    let delta=new Float64Array(output.length);
    for (let k=0; k<output.length; k++) {
      const diff=output[k]-targets[n][k];
      const abs=Math.abs(diff);
      const m=masks[n][k];
      if (m===0) continue;
      loss+=m*(abs<=HUBER_DELTA ? 0.5*diff*diff : HUBER_DELTA*(abs-0.5*HUBER_DELTA));
      delta[k]=m*Math.max(-HUBER_DELTA, Math.min(HUBER_DELTA, diff))/batch;
    }

    for (let l=layerCount-1; l>=0; l--) {
      const inSize=net.sizes[l];
      const outSize=net.sizes[l+1];
      const prev=layers[l];
      const w=net.weights[l];
      const gw=gradW[l];
      const gb=gradB[l];
      const prevDelta=new Float64Array(inSize);
      for (let o=0; o<outSize; o++) {
        const d=delta[o];
        if (d===0) continue;
        gb[o]+=d;
        const row=o*inSize;
        for (let i=0; i<inSize; i++) {
          gw[row+i]+=d*prev[i];
          prevDelta[i]+=d*w[row+i];
        }
      }
      // ReLU derivative on the hidden layer below (its activation is 0 exactly where the pre-activation was <= 0)
      if (l>0) for (let i=0; i<inSize; i++) if (prev[i]<=0) prevDelta[i]=0;
      delta=prevDelta;
    }
  }
  return { loss: loss/batch, gradW, gradB };
}

function adamStep(params: Float32Array, grad: Float32Array, m: Float32Array, v: Float32Array, lr: number, t: number): void {
  const c1=1-BETA1**t;
  const c2=1-BETA2**t;
  for (let i=0; i<params.length; i++) {
    m[i]=BETA1*m[i]+(1-BETA1)*grad[i];
    v[i]=BETA2*v[i]+(1-BETA2)*grad[i]*grad[i];
    params[i]-=lr*(m[i]/c1)/(Math.sqrt(v[i]/c2)+EPSILON);
  }
}

// One Adam step on a batch; returns the batch loss measured before the update
export function trainBatch(
  net: Mlp,
  adam: Adam,
  inputs: ArrayLike<number>[],
  targets: ArrayLike<number>[],
  masks: ArrayLike<number>[],
  lr: number,
): number {
  const { loss, gradW, gradB }=lossAndGradients(net, inputs, targets, masks);
  adam.t++;
  for (let l=0; l<net.weights.length; l++) {
    adamStep(net.weights[l], gradW[l], adam.mW[l], adam.vW[l], lr, adam.t);
    adamStep(net.biases[l], gradB[l], adam.mB[l], adam.vB[l], lr, adam.t);
  }
  return loss;
}

export function copyMlp(from: Mlp, to: Mlp): void {
  for (let l=0; l<from.weights.length; l++) {
    to.weights[l].set(from.weights[l]);
    to.biases[l].set(from.biases[l]);
  }
}

export function cloneMlp(net: Mlp): Mlp {
  return { sizes: net.sizes.slice(), weights: net.weights.map((w) => w.slice()), biases: net.biases.map((b) => b.slice()) };
}

export type SerializedMlp={
  sizes: number[];
  weights: number[][];
  biases: number[][];
};

function round5(v: number): number {
  return Math.round(v*1e5)/1e5;
}

export function serializeMlp(net: Mlp): SerializedMlp {
  return {
    sizes: net.sizes.slice(),
    weights: net.weights.map((w) => Array.from(w, round5)),
    biases: net.biases.map((b) => Array.from(b, round5)),
  };
}

function isFiniteArray(value: unknown, length: number): value is number[] {
  return Array.isArray(value)&&value.length===length&&value.every((v) => typeof v==="number"&&Number.isFinite(v));
}

// The JSON is loaded over the network: validate everything before building a network from it
export function parseMlp(input: unknown): Mlp | null {
  if (typeof input!=="object"||input===null) return null;
  const { sizes, weights, biases }=input as Partial<Record<keyof SerializedMlp, unknown>>;   // fields checked one by one below
  if (!Array.isArray(sizes)||sizes.length<2) return null;
  if (!sizes.every((s) => Number.isInteger(s)&&s>0)) return null;
  if (!Array.isArray(weights)||!Array.isArray(biases)) return null;
  if (weights.length!==sizes.length-1||biases.length!==sizes.length-1) return null;

  const net: Mlp={ sizes: sizes.slice(), weights: [], biases: [] };
  for (let l=0; l<sizes.length-1; l++) {
    if (!isFiniteArray(weights[l], sizes[l]*sizes[l+1])) return null;
    if (!isFiniteArray(biases[l], sizes[l+1])) return null;
    net.weights.push(Float32Array.from(weights[l]));
    net.biases.push(Float32Array.from(biases[l]));
  }
  return net;
}
