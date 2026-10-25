import type { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import * as M from '../shared/contracts/media-studio.ts';
import { mediaJobEvidence, mediaPortableSchemas } from '../shared/contracts/media-portable.ts';
import { suitePortableClaim } from '../shared/contracts/suite-portable.ts';
import { verifySuiteGraph, offlineHash, offlineSha, offlineKey } from './suite-offline.ts';
import { parseMediaCaptions, formatMediaCaptions, validateMediaRecipe } from './suite-media-analysis.ts';
export function verifyMediaBundle(bytes: Uint8Array) {
  const graph = verifySuiteGraph(
      bytes,
      'sakura-media-studio/1',
      Object.keys(mediaPortableSchemas),
      'media-sources',
    ),
    claims = new Map<string, unknown>();
  for (const row of graph.rows) {
    if (row.origin !== 'imported') throw new Error('MEDIA_PORTABLE_ORIGIN');
    if (row.kind === 'source') continue;
    claims.set(
      offlineKey(row),
      mediaPortableSchemas[row.domain].parse(suitePortableClaim.parse(row.content).claims),
    );
  }
  const get = <T>(r: S.SuiteRef, schema: z.ZodType<T>, owner?: S.SuiteRecord) =>
    schema.parse(claims.get(offlineKey(graph.get(r, owner))));
  let reviews = 0,
    jobs = 0,
    outputs = 0;
  for (const row of graph.rows) {
    if (row.kind === 'source') continue;
    const content = claims.get(offlineKey(row));
    if (row.domain === 'media-sources') {
      const p = M.mediaPinned.parse(content);
      S.suiteMaterial.parse(graph.get(p.source, row).content);
    }
    if (row.domain === 'media-inspect' || row.domain === 'media-workers') {
      const job = mediaJobEvidence.parse(content);
      jobs++;
      if (
        job.items.length !== job.result.items.length ||
        job.result.outcome !== (job.result.items.every((x) => x.state === 'verified') ? 'passed' : 'failed')
      )
        throw new Error('MEDIA_RESULT_COVERAGE');
      for (let i = 0; i < job.items.length; i++) {
        const item = job.items[i],
          out = job.result.items[i],
          source = get(item.source, M.mediaPinned, row),
          material = S.suiteMaterial.parse(graph.get(source.source).content);
        if (
          item.key !== out.key ||
          out.inputDigest !== material.digest ||
          (out.state === 'failed' && out.outputs.length) ||
          (out.state === 'verified' && (!out.facts || out.error))
        )
          throw new Error('MEDIA_RESULT_BINDING');
        if (job.mode === 'inspect' && (item.recipe || out.outputs.length))
          throw new Error('MEDIA_INSPECT_OUTPUT');
        if (job.mode === 'transform') {
          if (!item.recipe) throw new Error('MEDIA_RECIPE_REQUIRED');
          const recipe = get(item.recipe, M.mediaCompiled, row);
          if (
            offlineKey(recipe.source) !== offlineKey(item.source) ||
            (out.facts && offlineHash(out.facts) !== offlineHash(recipe.facts))
          )
            throw new Error('MEDIA_RECIPE_SOURCE');
        }
      }
      for (const published of job.published) {
        const item = job.result.items.find((x) => x.key === published.key),
          out = item?.outputs.find((x) => x.name === published.name),
          source = graph.get(published.source, row),
          data = graph.materials.get(offlineKey(source));
        if (
          item?.state !== 'verified' ||
          !out ||
          !data ||
          offlineSha(data) !== published.digest ||
          published.digest !== out.bytes.digest ||
          data.length !== out.bytes.bytes ||
          offlineHash(out.facts) !== offlineHash(published.facts)
        )
          throw new Error('MEDIA_PUBLISHED_DIGEST');
        if (
          out.format === 'png' &&
          (data.length < 24 ||
            !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
            data.readUInt32BE(16) !== out.facts.width ||
            data.readUInt32BE(20) !== out.facts.height)
        )
          throw new Error('MEDIA_PNG_DIMENSIONS');
        outputs++;
      }
    }
    if (row.domain === 'media-recipes') {
      const p = M.mediaCompiled.parse(content),
        inspection = get(p.inspection, mediaJobEvidence, row),
        item = inspection.result.items.find((x) => x.key === p.item),
        selected = inspection.items.find((x) => x.key === p.item);
      if (
        inspection.mode !== 'inspect' ||
        item?.state !== 'verified' ||
        !selected ||
        offlineKey(selected.source) !== offlineKey(p.source) ||
        offlineHash(item.facts) !== offlineHash(p.facts)
      )
        throw new Error('MEDIA_RECIPE_FACTS');
      validateMediaRecipe(p.recipe, p.facts);
    }
    if (row.domain === 'media-captions') {
      const c = M.mediaCaption.parse(content),
        job = get(c.job, mediaJobEvidence, row),
        p = job.published.find((x) => offlineKey(x.source) === offlineKey(c.source));
      if (!p || p.facts.durationMs !== c.durationMs || !['wav', 'mp4'].includes(p.facts.format))
        throw new Error('MEDIA_CAPTION_DURATION');
      parseMediaCaptions(formatMediaCaptions(c.cues), c.durationMs);
    }
    if (row.domain === 'media-collections') {
      const c = M.mediaCollection.parse(content);
      if (new Set(c.entries.map((x) => x.name.toLowerCase())).size !== c.entries.length)
        throw new Error('MEDIA_COLLECTION_NAMES');
      for (const e of c.entries) {
        const material = S.suiteMaterial.parse(graph.get(e.source, row).content);
        if (
          material.digest !== e.digest ||
          material.bytes !== e.bytes ||
          !!e.job === !!e.caption ||
          !e.name.toLowerCase().endsWith('.' + e.format)
        )
          throw new Error('MEDIA_COLLECTION_BYTES');
        if (e.job) {
          const job = get(e.job, mediaJobEvidence, row);
          if (
            !job.published.some(
              (x) =>
                offlineKey(x.source) === offlineKey(e.source) &&
                x.digest === e.digest &&
                x.facts.format === e.format,
            )
          )
            throw new Error('MEDIA_COLLECTION_PUBLICATION');
        }
        if (e.caption) {
          const caption = get(e.caption, M.mediaCaption, row);
          if (e.format !== 'srt' || offlineSha(formatMediaCaptions(caption.cues)) !== e.digest)
            throw new Error('MEDIA_COLLECTION_CAPTION');
        }
      }
    }
    if (row.domain === 'media-reviews') {
      const r = M.mediaReview.parse(content);
      get(r.collection, M.mediaCollection, row);
      if (r.decision !== 'accepted' || !r.humanPreviewed || !r.observations)
        throw new Error('MEDIA_ACCEPTED_REVIEW_REQUIRED');
      reviews++;
    }
  }
  if (!reviews) throw new Error('MEDIA_REVIEW_REQUIRED');
  return {
    format: 'sakura-media-studio/1',
    valid: true,
    objects: graph.rows.length,
    jobs,
    outputs,
    reviews,
    sourceTrust: 'unauthenticated',
    mediaDecoded: false,
    approvalsTransferred: false,
    manifestDigest: graph.manifestDigest,
  };
}
