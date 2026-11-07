/**
 * Lecture d'un modèle multifactoriel : contributions des facteurs et
 * régressions partielles (Frisch-Waugh-Lovell).
 *
 * Toutes les décompositions sont exactes pour une OLS avec constante :
 *  - rendement moyen : ȳ = α + Σ_j β_j x̄_j ;
 *  - variance expliquée : R² = Σ_j β_j cov(x_j, y) / var(y) ;
 *  - régression partielle du facteur j : en résidualisant y et x_j sur les
 *    autres régresseurs (constante comprise), la pente de ẽ_y sur ẽ_x vaut
 *    β_j et ses résidus sont ceux du modèle complet.
 */

import { crossprod, crossprodVec, invSPD, matvec, type Matrix, type Vector } from './linalg.ts';
import type { OLSResult } from './ols.ts';

const mean = (v: Vector) => v.reduce((s, a) => s + a, 0) / v.length;

function covariance(a: Vector, b: Vector): number {
  const ma = mean(a);
  const mb = mean(b);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (a.length - 1);
}

export interface MeanContribution {
  /** Nom du régresseur ('const' pour α). */
  name: string;
  beta: number;
  /** Moyenne mensuelle du facteur (1 pour la constante). */
  premium: number;
  /** Contribution mensuelle au rendement excédentaire moyen : β_j x̄_j (α pour la constante). */
  value: number;
}

export interface Decomposition {
  /** Rendement excédentaire moyen observé (mensuel). */
  meanY: number;
  mean: MeanContribution[];
  /** Contributions des facteurs (sans constante) à la variance expliquée ; somme = R². */
  variance: { name: string; value: number }[];
}

export function decompose(y: Vector, x: Matrix, res: OLSResult): Decomposition {
  const k = res.beta.length;
  const col = (j: number) => x.map((row) => row[j]);
  const vy = covariance(y, y);
  const meanC: MeanContribution[] = [];
  const variance: { name: string; value: number }[] = [];
  for (let j = 0; j < k; j++) {
    const xj = col(j);
    const premium = j === 0 ? 1 : mean(xj);
    meanC.push({ name: res.names[j], beta: res.beta[j], premium, value: res.beta[j] * premium });
    if (j > 0) variance.push({ name: res.names[j], value: (res.beta[j] * covariance(xj, y)) / vy });
  }
  return { meanY: mean(y), mean: meanC, variance };
}

export interface PartialRegression {
  name: string;
  /** Résidu du facteur j sur les autres régresseurs. */
  ex: Vector;
  /** Résidu de y sur les autres régresseurs. */
  ey: Vector;
  /** Pente = β_j du modèle complet. */
  slope: number;
  /** Erreur standard de β_j selon la méthode d'inférence choisie. */
  se: number;
  stat: number;
  pvalue: number;
  /** Valeur critique de l'intervalle de confiance. */
  crit: number;
  /** R² partiel : part de la variance de ẽ_y expliquée par ẽ_x. */
  partialR2: number;
}

function residualize(v: Vector, z: Matrix, zInv: Matrix): Vector {
  const g = matvec(zInv, crossprodVec(z, v));
  return v.map((vi, i) => vi - z[i].reduce((s, zij, l) => s + zij * g[l], 0));
}

/** Régression partielle (added-variable plot) du régresseur d'indice j ≥ 1. */
export function partialRegression(y: Vector, x: Matrix, res: OLSResult, j: number): PartialRegression {
  if (j < 1 || j >= res.beta.length) throw new RangeError(`Invalid regressor index ${j}.`);
  const others = res.names.map((_, l) => l).filter((l) => l !== j);
  const z = x.map((row) => others.map((l) => row[l]));
  const zInv = invSPD(crossprod(z));
  const ex = residualize(x.map((row) => row[j]), z, zInv);
  const ey = residualize(y, z, zInv);
  const sxx = ex.reduce((s, a) => s + a * a, 0);
  const sxy = ex.reduce((s, a, i) => s + a * ey[i], 0);
  const syy = ey.reduce((s, a) => s + a * a, 0);
  return {
    name: res.names[j],
    ex,
    ey,
    slope: sxy / sxx,
    se: res.se[j],
    stat: res.stat[j],
    pvalue: res.pvalue[j],
    crit: res.crit,
    partialR2: syy > 0 ? (sxy * sxy) / (sxx * syy) : 0,
  };
}

export function partialRegressions(y: Vector, x: Matrix, res: OLSResult): PartialRegression[] {
  return res.names.slice(1).map((_, i) => partialRegression(y, x, res, i + 1));
}
