import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../config.dart';

// Family colour band, see DESIGN.md. Same values as packages/shared/src/band.ts:
// glow for gradient surfaces and dark backgrounds, deep for text on light ones.
const glow = [
  Color(0xFFF2545B),
  Color(0xFFFB8C45),
  Color(0xFFF2C14E),
  Color(0xFF6CCF8E),
  Color(0xFF46BFE0),
  Color(0xFF8E92F8),
  Color(0xFFC39BF2),
];
const deep = [
  Color(0xFFB3262D),
  Color(0xFFA8461A),
  Color(0xFF876008),
  Color(0xFF1D6A44),
  Color(0xFF156A88),
  Color(0xFF3B3EA8),
  Color(0xFF6A33A0),
];

const paper = Color(0xFFF4F4F1);
const ink = Color(0xFF17171A);
const muted = Color(0xFF5E5E66);
const hairline = Color(0x2917171A);
const displayFont = 'Bricolage Grotesque';
const _radius = BorderRadius.all(Radius.circular(8));

/// Colour at a position from 1 to 7, linear between neighbouring stages.
Color bandColor(double position, List<Color> tones) {
  final p = position.clamp(1.0, 7.0);
  final i = math.min(5, (p - 1).floor());
  return Color.lerp(tones[i], tones[i + 1], p - 1 - i)!;
}

/// Gradient of this app's section, from bottom left to top right.
LinearGradient bandGradient(List<Color> tones) => LinearGradient(
  begin: Alignment.bottomLeft,
  end: Alignment.topRight,
  colors: [
    bandColor(appBand.from, tones),
    bandColor((appBand.from + appBand.to) / 2, tones),
    bandColor(appBand.to, tones),
  ],
);

ThemeData buildTheme() {
  final accent = bandColor((appBand.from + appBand.to) / 2, deep);
  final base = ThemeData(
    colorScheme: ColorScheme.fromSeed(seedColor: accent, primary: accent, surface: paper, onSurface: ink),
    scaffoldBackgroundColor: paper,
  );
  TextStyle? display(TextStyle? style) => style?.copyWith(
    fontFamily: displayFont,
    fontWeight: FontWeight.w700,
    fontVariations: const [FontVariation('wdth', 80), FontVariation('wght', 750)],
  );
  final text = base.textTheme;
  return base.copyWith(
    textTheme: text.copyWith(
      displayLarge: display(text.displayLarge),
      displayMedium: display(text.displayMedium),
      displaySmall: display(text.displaySmall),
      headlineLarge: display(text.headlineLarge),
      headlineMedium: display(text.headlineMedium),
      headlineSmall: display(text.headlineSmall),
      titleLarge: display(text.titleLarge),
    ),
    appBarTheme: const AppBarTheme(backgroundColor: paper, foregroundColor: ink),
    filledButtonTheme: FilledButtonThemeData(
      style: ButtonStyle(
        backgroundColor: const WidgetStatePropertyAll(Colors.transparent),
        foregroundColor: const WidgetStatePropertyAll(ink),
        shape: const WidgetStatePropertyAll(RoundedRectangleBorder(borderRadius: _radius)),
        backgroundBuilder: (context, states, child) => Opacity(
          opacity: states.contains(WidgetState.disabled) ? 0.5 : 1,
          child: DecoratedBox(
            decoration: BoxDecoration(gradient: bandGradient(glow), borderRadius: _radius),
            child: child,
          ),
        ),
      ),
    ),
  );
}

/// Sender line at the bottom of a screen: made by Pleasance, and where this app
/// sits on the family band.
class PleasanceFooter extends StatelessWidget {
  const PleasanceFooter({super.key});

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
        decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: hairline)),
        ),
        child: Row(
          children: [
            Text('ein Werkzeug von', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: muted)),
            const SizedBox(width: 8),
            SvgPicture.asset(
              'assets/pleasance-wordmark.svg',
              height: 13,
              colorFilter: const ColorFilter.mode(muted, BlendMode.srcIn),
              semanticsLabel: 'Pleasance',
            ),
            const Spacer(),
            const _BandLine(),
          ],
        ),
      ),
    );
  }
}

class _BandLine extends StatelessWidget {
  const _BandLine();

  static const _width = 120.0;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: _width,
      height: 9,
      child: Stack(
        children: [
          Positioned(
            left: 0,
            right: 0,
            top: 3,
            height: 3,
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: const BorderRadius.all(Radius.circular(2)),
                gradient: LinearGradient(colors: [for (final c in glow) Color.lerp(c, Colors.white, 0.6)!]),
              ),
            ),
          ),
          Positioned(
            left: _width * (appBand.from - 1) / 6,
            top: 0,
            width: math.max(9, _width * (appBand.to - appBand.from) / 6),
            height: 9,
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: bandGradient(glow),
                borderRadius: const BorderRadius.all(Radius.circular(5)),
                boxShadow: const [BoxShadow(color: paper, spreadRadius: 2)],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
