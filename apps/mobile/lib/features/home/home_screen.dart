import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../config.dart';

/// Freiburg, until the user shares their location.
const _fallbackCenter = LatLng(47.999, 7.842);

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _map = MapController();
  LatLng? _position;

  Future<void> _locate() async {
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
    if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
      if (mounted) _showMessage('Standort nicht freigegeben');
      return;
    }
    try {
      final p = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.medium, timeLimit: Duration(seconds: 15)),
      );
      if (!mounted) return;
      setState(() => _position = LatLng(p.latitude, p.longitude));
      _map.move(_position!, 15);
    } catch (e) {
      // Location services off or timeout
      if (mounted) _showMessage('Standort nicht verfügbar');
    }
  }

  void _showMessage(String text) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text(appName),
        actions: [IconButton(icon: const Icon(Icons.person_outline), onPressed: () => context.go('/profile'))],
      ),
      body: FlutterMap(
        mapController: _map,
        options: const MapOptions(initialCenter: _fallbackCenter, initialZoom: 13),
        children: [
          TileLayer(urlTemplate: mapTileUrl, userAgentPackageName: appId),
          if (_position != null)
            MarkerLayer(markers: [Marker(point: _position!, child: const Icon(Icons.my_location, color: Colors.blue))]),
          // Required by the OSM tile usage policy
          const SimpleAttributionWidget(source: Text('OpenStreetMap contributors')),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _locate,
        tooltip: 'Mein Standort',
        child: const Icon(Icons.my_location),
      ),
    );
  }
}
