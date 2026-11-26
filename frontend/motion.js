// Short, finite transitions; never change map coordinates or keyboard focus.
export function revealMap(root) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    root.querySelectorAll('.person-node').forEach((node, i) => {
        node.animate([
            {opacity: 0, translate: '0 22px', scale: '.92'},
            {opacity: 1, translate: '0 0', scale: '1'}
        ], {duration: 440, delay: Math.min(i, 10) * 45, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards'});
    });
    root.querySelector('.rings')?.animate([
        {opacity: 0, scale: '.88'}, {opacity: 1, scale: '1'}
    ], {duration: 650, easing: 'cubic-bezier(.16,1,.3,1)'});
    root.querySelectorAll('.edges line:not(.hit)').forEach(line => {
        const length = Math.hypot(Number(line.getAttribute('x2')) - Number(line.getAttribute('x1')),
                                  Number(line.getAttribute('y2')) - Number(line.getAttribute('y1')));
        if (!line.classList.contains('proposed')) line.animate([
            {strokeDasharray: `${length}`, strokeDashoffset: length},
            {strokeDasharray: `${length}`, strokeDashoffset: 0}
        ], {duration: 550, easing: 'ease-out'});
    });
}
