# Original Build Brief

The product-specification portion of the original request is preserved below
verbatim. Image attachments, skill-loader instructions, and a closing paragraph
of local workflow references were omitted because they were supporting context,
not product requirements. No requirement in the brief below was rewritten.

---

I want you to build an interactive 3D human brain explorer as a web app. Not a medical tool. A museum exhibit you can spin with your finger. One brain in the center of the screen. You orbit it with your mouse. You click a region, it highlights, the camera smoothly zooms in, and a small card tells you what that part does in one plain sentence a 12 year old would understand.

It should feel premium. Dark background, smooth transitions, soft glow on hover, cinematic camera moves when you select a region. Think Apple product page meets science museum. Not a textbook. Not a dashboard.

Tech stack: Next.js App Router, React, TypeScript, Tailwind CSS, Three.js via React Three Fiber. I will provide the brain .glb model separately. For now build with a placeholder segmented sphere. I'll swap the real model in later.

10 clickable brain regions, each with a name, highlight color, and one-sentence description:

1. Frontal Lobe — "where you make decisions and plan ahead"
2. Parietal Lobe — "processes touch, temperature, and spatial awareness"
3. Temporal Lobe — "handles hearing and helps form memories"
4. Occipital Lobe — "processes everything you see"
5. Cerebellum — "coordinates your balance and movement"
6. Brain Stem — "controls breathing, heart rate, and sleep"
7. Hippocampus — "where short-term memories become long-term ones"
8. Amygdala — "processes fear, anger, and emotional reactions"
9. Prefrontal Cortex — "responsible for personality and impulse control"
10. Corpus Callosum — "connects the left and right brain so they can talk"

## How to build this

Work on ONE system at a time in this exact order. Do NOT fan out multiple sub-agents in parallel. Build each system sequentially:

1. Scene setup — React Three Fiber canvas, PBR lighting, orbit controls with damping, dark background, slow auto-rotation. The brain should feel like it's floating in space
2. Brain model and region segmentation — load .glb (placeholder sphere for now), split into 10 clickable zones using raycasting. Each region must be a separate selectable area
3. Hover and selection — hover glow effect with emissive highlight, click locks the selection with a stronger color shift. Deselect on click elsewhere or escape
4. Camera animation — smooth lerp to the selected region on click, slight zoom in, pull back to default orbit on deselect. Should feel cinematic, not snappy
5. Info card UI — slide-in card with region name, one-sentence description, colored dot matching the region. Rounded corners, glass blur background. Card disappears smoothly on deselect
6. Region sidebar — vertical list of all 10 regions as small buttons. Click any to fly the camera there. Active region highlighted. Synced with 3D clicks
7. Mobile responsive — touch orbit controls, bottom sheet instead of sidebar card, tap to select regions
8. Polish — loading state, transition curves, font sizing, spacing, overall feel

For each system: build it, then spawn ONE separate sub-agent as a harsh visual and UX critic. The critic should compare the result against the best interactive 3D product pages (Apple Vision Pro page, Stripe Globe, Linear's landing page) and rate whether it feels that polished. If it doesn't, keep iterating on that system before moving to the next one.

The critic must never be the same agent that built the thing. It should only see the rendered output, not the code.

/loop on each system until the critic says it genuinely feels like a premium interactive experience someone would bookmark, not a homework project. Then move to the next system.

The test: show this to someone who knows nothing about brains. If they immediately start clicking and say "oh cool" within 5 seconds, it works. If they need instructions, it doesn't.

Don't stop until this feels like something Apple would put on their website.
