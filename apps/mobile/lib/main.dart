import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

import 'app.dart';
import 'core/auth.dart';

Future<void> main() async {
  // Empty DSN = GlitchTip off
  await SentryFlutter.init(
    (options) => options
      ..dsn = const String.fromEnvironment('SENTRY_DSN')
      ..environment = const String.fromEnvironment('SENTRY_ENVIRONMENT', defaultValue: 'production')
      ..sendDefaultPii = false
      ..maxBreadcrumbs = 0
      ..tracesSampleRate = 0
      ..enableAutoSessionTracking = false,
    appRunner: startApp,
  );
}

Future<void> startApp() async {
  WidgetsFlutterBinding.ensureInitialized();
  // The saved session is read before the first frame, so the router never
  // shows the login screen to someone who is logged in.
  final container = ProviderContainer();
  await container.read(authProvider.future);
  runApp(UncontrolledProviderScope(container: container, child: const App()));
}
