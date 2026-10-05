<script lang="ts">
  import { APP_BAND } from '@app/shared';
</script>

<footer>
  <a href="https://pleasance.org">ein Werkzeug von <span class="wordmark" role="img" aria-label="Pleasance"></span></a>
  <span class="band" aria-hidden="true"><span
      class="marker"
      style:left="{((APP_BAND.from - 1) / 6) * 100}%"
      style:width="{((APP_BAND.to - APP_BAND.from) / 6) * 100}%"
    ></span></span>
</footer>

<style>
  footer {
    display: flex;
    gap: 1rem;
    align-items: center;
    padding: 1rem 1.5rem;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 0.8125rem;
  }
  a {
    display: inline-flex;
    gap: 0.5rem;
    align-items: center;
    text-decoration: none;
  }
  .wordmark {
    width: 76px;
    height: 14px;
    background: currentColor;
    mask: url('/pleasance-wordmark.svg') left center / contain no-repeat;
  }
  .band {
    position: relative;
    width: 8.5rem;
    height: 3px;
    margin-left: auto;
    border-radius: 2px;
    background: linear-gradient(rgb(255 255 255 / 0.6), rgb(255 255 255 / 0.6)), var(--spectrum);
  }
  .marker {
    position: absolute;
    top: -3px;
    min-width: 9px;
    height: 9px;
    border-radius: 5px;
    background: var(--gradient);
    box-shadow: 0 0 0 2px var(--bg);
  }
</style>
