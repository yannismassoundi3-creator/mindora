import React, { useCallback } from 'react';
import Particles from 'react-tsparticles';
import { loadSlim } from 'tsparticles-slim';
import type { Container, Engine } from 'tsparticles-engine';

interface ParticlesBackgroundProps {
  id?: string;
}

export const ParticlesBackground: React.FC<ParticlesBackgroundProps> = ({ id = "tsparticles" }) => {
  const particlesInit = useCallback(async (engine: Engine) => {
    // loadSlim avoids loading unnecessary features, improving performance
    await loadSlim(engine);
  }, []);

  const particlesLoaded = useCallback(async (container: Container | undefined) => {
    console.log("Particles loaded", container);
  }, []);

  return (
    <Particles
      id={id}
      init={particlesInit}
      loaded={particlesLoaded}
      options={{
        background: {
          color: {
            value: "transparent",
          },
        },
        fpsLimit: 60,
        interactivity: {
          events: {
            onHover: {
              enable: true,
              mode: "repulse",
            },
            resize: true,
          },
          modes: {
            repulse: {
              distance: 100,
              duration: 0.4,
            },
          },
        },
        particles: {
          color: {
            value: "#ffffff",
          },
          links: {
            color: "#ffffff",
            distance: 150,
            enable: true,
            opacity: 0.1,
            width: 1,
          },
          move: {
            direction: "none",
            enable: true,
            outModes: {
              default: "bounce",
            },
            random: false,
            speed: 0.5, // Très lent pour ne pas distraire
            straight: false,
          },
          number: {
            density: {
              enable: true,
              area: 800,
            },
            value: 40, // Pas trop pour les performances
          },
          opacity: {
            value: 0.2, // Très discret
          },
          shape: {
            type: "circle",
          },
          size: {
            value: { min: 1, max: 3 },
          },
        },
        detectRetina: true,
        fullScreen: { enable: true, zIndex: -1 }, // En arrière-plan absolu
      }}
    />
  );
};
